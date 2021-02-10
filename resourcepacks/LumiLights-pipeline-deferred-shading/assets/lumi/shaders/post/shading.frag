#include lumi:shaders/context/post/header.glsl
#include lumi:shaders/context/forward/common.glsl
#include frex:shaders/lib/math.glsl
#include frex:shaders/lib/noise/noise2d.glsl
#include frex:shaders/lib/noise/noise3d.glsl
#include frex:shaders/lib/noise/cellular2x2x2.glsl
#include frex:shaders/api/sampler.glsl
#include frex:shaders/api/view.glsl
#include frex:shaders/api/world.glsl
#include frex:shaders/api/player.glsl
#include frex:shaders/api/material.glsl
#include lumi:shaders/lib/util.glsl
#include lumi:shaders/lib/fog.glsl
#include lumi:shaders/lib/tonemap.glsl
#include lumi:shaders/lib/pbr_shading.glsl
#include lumi:shaders/lib/puddle.glsl
#include lumi:shaders/context/post/bloom.glsl
#include lumi:shaders/context/post/fog.glsl
#include lumi:shaders/context/global/lighting.glsl
#include lumi:shaders/context/global/experimental.glsl

/*******************************************************
 *  lumi:shaders/post/shading.frag            *
 *******************************************************
 *  Copyright (c) 2020-2021 spiralhalo                 *
 *  Released WITHOUT WARRANTY under the terms of the   *
 *  GNU Lesser General Public License version 3 as     *
 *  published by the Free Software Foundation, Inc.    *
 *******************************************************/

uniform sampler2D u_solid_color;
uniform sampler2D u_solid_depth;
uniform sampler2D u_light_solid;
uniform sampler2D u_normal_solid;
uniform sampler2D u_material_solid;

uniform sampler2D u_translucent_color;
uniform sampler2D u_translucent_depth;
uniform sampler2D u_light_translucent;
uniform sampler2D u_normal_translucent;
uniform sampler2D u_material_translucent;

uniform sampler2D u_particles_color;
uniform sampler2D u_particles_depth;
uniform sampler2D u_light_particles;

uniform sampler2D u_ao;

varying mat4 v_star_rotator;
varying mat4 v_cloud_rotator;
varying float v_fov;
varying float v_night;
varying float v_not_in_void;
varying float v_near_void_core;
varying vec3 v_sky_radiance;

const vec3 VOID_CORE_COLOR = hdr_gammaAdjust(vec3(1.0, 0.7, 0.5));

vec3 coords_view(vec2 uv, mat4 inv_projection, float depth)
{
    vec3 clip = vec3(2.0 * uv - 1.0, 2.0 * depth - 1.0);
    vec4 view = inv_projection * vec4(clip, 1.0);
    return view.xyz / view.w;
}

vec2 coords_uv(vec3 view, mat4 projection)
{
    vec4 clip = projection * vec4(view, 1.0);
    clip.xyz /= clip.w;
    return clip.xy * 0.5 + 0.5;
}

float raymarched_fog_density(vec3 viewPos, vec3 worldPos, float fogFar)
{
    vec3 unitMarch = normalize(-viewPos);
    vec3 ray_view = viewPos;
    float distToCamera = distance(worldPos, frx_cameraPos());
    int stepCount = 0;
    while (ray_view.z < 0 && stepCount < 128) {
        stepCount ++;
        ray_view += unitMarch;
    }
    return float(stepCount) / fogFar;
}

vec4 fog (float skylightFactor, vec4 a, vec3 viewPos, vec3 worldPos, inout float bloom)
{
    float zigZagTime = abs(frx_worldTime()-0.5);
    float timeFactor = (l2_clampScale(0.45, 0.5, zigZagTime) + l2_clampScale(0.05, 0.0, zigZagTime));
    timeFactor = frx_worldFlag(FRX_WORLD_HAS_SKYLIGHT) ? timeFactor : 1.0;

    float fogDensity = frx_playerFlag(FRX_PLAYER_EYE_IN_FLUID) ? UNDERWATER_FOG_DENSITY : FOG_DENSITY;
    float fogFar = frx_playerFlag(FRX_PLAYER_EYE_IN_FLUID) ? UNDERWATER_FOG_FAR : FOG_FAR;
    float fogNear = frx_playerFlag(FRX_PLAYER_EYE_IN_FLUID) ? UNDERWATER_FOG_NEAR : FOG_NEAR;
    fogFar = max(fogNear, fogFar);

    float fogTop = FOG_TOP * 0.5 + 0.5 * FOG_TOP * timeFactor;
    
    // float fog_noise = snoise(worldPos.xz * FOG_NOISE_SCALE + frx_renderSeconds() * FOG_NOISE_SPEED) * FOG_NOISE_HEIGHT;
    float heightFactor = l2_clampScale(FOG_TOP /*+ fog_noise*/, FOG_BOTTOM, worldPos.y);
    heightFactor = frx_playerFlag(FRX_PLAYER_EYE_IN_FLUID) ? 1.0 : heightFactor;

    #if defined(VOLUMETRIC_FOG)
    float fogFactor = fogDensity * heightFactor;
    #else
    float fogFactor = fogDensity * heightFactor * skylightFactor;
    #endif

    if (frx_playerHasEffect(FRX_EFFECT_BLINDNESS)) {
        float blindnessModifier = l2_clampScale(0.5, 1.0, 1.0 - frx_luminance(v_skycolor));
        fogFar = mix(fogFar, 3.0, blindnessModifier);
        fogNear = mix(fogNear, 0.0, blindnessModifier);
        fogFactor = mix(fogFactor, 1.0, blindnessModifier);
    }

    if (frx_playerFlag(FRX_PLAYER_EYE_IN_LAVA)) {
        fogFar = frx_playerHasEffect(FRX_EFFECT_FIRE_RESISTANCE) ? 2.5 : 0.5;
        fogNear = 0.0;
        fogFactor = 1.0;
    }

    // TODO: retrieve fog distance from render distance ?
    // PERF: use projection z (linear depth) instead of length(viewPos)

    #if defined(VOLUMETRIC_FOG)
    float distFactor = raymarched_fog_density(viewPos, worldPos, fogFar);
    #else
    float distFactor = l2_clampScale(fogNear, fogFar, length(viewPos));
    distFactor *= distFactor;
    #endif

    fogFactor = clamp(fogFactor * distFactor, 0.0, 1.0);
    
    vec4 fogColor = vec4(v_skycolor, 1.0);
    bloom = mix(bloom, 0.0, fogFactor);
    return mix(a, fogColor, fogFactor);
}

float caustics(vec3 worldPos)
{
    if (!frx_worldFlag(FRX_WORLD_IS_OVERWORLD)) return 0.0;
    // turns out, to get accurate coords, a global y-coordinate of water surface is required :S
    // 64 is used for the time being..
    // TODO: might need to prevent division by 0 ?
    return 1.0 - abs(cellular2x2x2(vec3(worldPos.xz + (64.0-worldPos.y) * frx_skyLightVector().xz / frx_skyLightVector().y, frx_renderSeconds())).x);
}

float volumetric_caustics_beam(vec3 worldPos)
{
    // const float stepSize = 0.125;
    // const float maxDist = 16.0;
    const float stepSize = 0.25;
    const float maxDist = 8.0;
    const float stepLimit = maxDist / stepSize;
    const int iStepLimit = int(stepLimit);

    vec3 unitMarch = normalize(frx_cameraPos()-worldPos);
    vec3 stepMarch = unitMarch * stepSize;
    vec3 ray_world = worldPos;

    float distToCamera = distance(worldPos, frx_cameraPos());
    int maxSteps = min(iStepLimit, int(distToCamera / stepSize));

    if (distToCamera >= maxDist) {
        ray_world += unitMarch * (distToCamera - maxDist);
    }

    int stepCount = 0;
    float power = 0.0;
    while (stepCount < maxSteps) {
        // power += smoothstep(0.5, 0.0, caustics(ray_world));
        power += 1.0-1.5*caustics(ray_world);
        stepCount ++;
        ray_world += stepMarch;
    }

    return max(0.0, float(power) / stepLimit);
}

void custom_sky(in vec3 viewPos, in float blindnessFactor, inout vec4 a, inout float bloom_out)
{
    vec3 skyVec = normalize(viewPos);
    vec3 worldSkyVec = skyVec * frx_normalModelMatrix();
    float skyDotUp = dot(skyVec, v_up);
    bloom_out = 0.0;

    if (frx_worldFlag(FRX_WORLD_IS_OVERWORLD) && v_not_in_void > 0.0) {
        float rainFactor = frx_rainGradient() * 0.67 + frx_thunderGradient() * 0.33;
        float cloud = 0.0;
        #ifdef CUSTOM_CLOUD_RENDERING
            // cloud
            // convert hemisphere to plane centered around cameraPos
            vec2 cloudPlane = worldSkyVec.xz / (0.1 + worldSkyVec.y) * 100.0
                + frx_cameraPos().xz + vec2(4.0) * frx_renderSeconds();//(frx_worldDay() + frx_worldTime());
            vec2 rotatedCloudPlane = (v_cloud_rotator * vec4(cloudPlane.x, 0.0, cloudPlane.y, 0.0)).xz;
            cloudPlane *= 0.1;

            float cloudBase = 1.0
                * l2_clampScale(0.0, 0.1, skyDotUp)
                * l2_clampScale(-0.5 - rainFactor * 0.5, 1.0 - rainFactor, snoise(rotatedCloudPlane * 0.005));
            float cloud1 = cloudBase * l2_clampScale(-1.0, 1.0, snoise(rotatedCloudPlane * 0.015));
            float cloud2 = cloud1 * l2_clampScale(-1.0, 1.0, snoise(rotatedCloudPlane * 0.04));
            float cloud3 = cloud2 * l2_clampScale(-1.0, 1.0, snoise(rotatedCloudPlane * 0.1));

            cloud = cloud1 * 0.5 + cloud2 * 0.75 + cloud3;
            cloud = l2_clampScale(0.1, 0.4, cloud);
            
            float cloudColor = frx_ambientIntensity() * frx_ambientIntensity() * (1.0 - 0.3 * rainFactor);

            // blend
            a.rgb = a.rgb * (1.0 - cloud) + vec3(cloudColor) * cloud;
        #endif

        // stars
        float starry = l2_clampScale(0.4, 0.0, frx_luminance(a.rgb)) * v_night;
        starry *= l2_clampScale(-0.6, -0.5, skyDotUp); //prevent star near the void core
        float occlusion = (1.0 - rainFactor) * (1.0 - cloud);
        vec4 starVec = v_star_rotator * vec4(worldSkyVec, 0.0);
        vec3 nonMilkyAxis = vec3(-0.598964, 0.531492, 0.598964);
        float milkyness = l2_clampScale(0.5, 0.0, abs(dot(nonMilkyAxis, worldSkyVec.xyz)));
        float star = starry * smoothstep(0.75 - milkyness * 0.3, 0.9, snoise(starVec.xyz * 100));
        // zoom sharpening
        float zoomFactor = l2_clampScale(90, 30, v_fov);
        star = l2_clampScale(0.3 * zoomFactor, 1.0 - 0.6 * zoomFactor, star) * occlusion;
        float milkyHaze = starry * occlusion * (1.0-frx_ambientIntensity()) * milkyness * 0.4 * l2_clampScale(-1.0, 1.0, snoise(starVec.xyz * 2.0));
        vec3 starRadiance = vec3(star) + vec3(0.9, 0.75, 1.0) * milkyHaze;
        a.rgb += starRadiance;
        bloom_out += (star + milkyHaze);
    }

    //prevent sky in the void for extra immersion
    if (frx_worldFlag(FRX_WORLD_IS_OVERWORLD)) {
        // VOID CORE
        float voidCore = l2_clampScale(-0.8 + v_near_void_core, -1.0 + v_near_void_core, skyDotUp); 
        vec3 voidColor = mix(vec3(0.0), VOID_CORE_COLOR, voidCore);
        bloom_out = voidCore;
        a.rgb = mix(voidColor, a.rgb, v_not_in_void);
    }

    bloom_out += l2_skyBloom();
    bloom_out *= blindnessFactor;

    // vec3 skyDownColor = vec3(frx_ambientIntensity());
    // starRadiance + mix(skyDownColor, v_skycolor, l2_clampScale(-1.0, 1.0, dot(skyVec, v_up)))
}

const float RADIUS = 0.4;
const float BIAS = 0.4;
const float INTENSITY = 10.0;

vec4 hdr_shaded_color(
    vec2 uv,
    sampler2D scolor, sampler2D sdepth, sampler2D slight, sampler2D snormal, sampler2D smaterial,
    float aoval, bool translucent, float translucentDepth, out float bloom_out)
{
    vec4 a = texture2D(scolor, uv);
    float depth = texture2D(sdepth, uv).r;
    vec3 viewPos = coords_view(uv, frx_inverseProjectionMatrix(), depth);
    if (depth == 1.0 && !translucent) {
        // the sky
        float blindnessFactor = frx_playerHasEffect(FRX_EFFECT_BLINDNESS) ? 0.0 : 1.0;
        custom_sky(viewPos, blindnessFactor, a, bloom_out);
        return vec4(a.rgb * blindnessFactor, 0.0);
    }

    vec3  normal    = texture2D(snormal, uv).xyz * 2.0 - 1.0;
    vec4  light     = texture2D(slight, uv);
    vec3  material  = texture2D(smaterial, uv).xyz;
    float roughness = material.x == 0.0 ? 1.0 : min(1.0, 1.0203 * material.x - 0.01);
    float metallic  = material.y;
    vec3  worldPos  = frx_cameraPos() + (frx_inverseViewMatrix() * vec4(viewPos, 1.0)).xyz;
    float f0        = material.z;
    float bloom_raw = light.z * 2.0 - 1.0;
    bool  diffuse   = material.x < 1.0;
    bool  matflash  = f0 > 0.95;
    bool  mathurt   = f0 > 0.85 && !matflash;
    // return vec4(coords_view(uv, frx_inverseProjectionMatrix(), depth), 1.0);

    #if defined(SHADOW_MAP_PRESENT) && defined(DEFERRED_SHADOW)
        vec4 shadowCoords = frx_shadowViewProjectionMatrix() * vec4(worldPos, 1.0);
        shadowCoords.xyz /= shadowCoords.w;
        shadowCoords.xyz = shadowCoords.xyz * 0.5 + 0.5;
        float bias = 0.0;
        float shadowDepth = texture2DArray(frxs_shadowMap, vec3(shadowCoords.xy, 0)).r; 
        float shadowFactor = (shadowDepth + bias < shadowCoords.z) ? 1.0 : 0.0;      
        light.z = 1.0 - shadowFactor;
    #else
        light.z = light.y;
    #endif

    #if CAUSTICS_MODE == CAUSTICS_MODE_TEXTURE
        if (!translucent) {
            if ((translucentDepth >= depth && frx_playerFlag(FRX_PLAYER_EYE_IN_FLUID))
                || (translucentDepth < depth && !frx_playerFlag(FRX_PLAYER_EYE_IN_FLUID))) {
                #if defined(SHADOW_MAP_PRESENT)
                    light.z = mix(light.z, 0.0, min(1.0, 0.25 * caustics(worldPos)));
                #else
                    light.z = mix(1.0, light.z, (1.0-light.z) * min(1.0, 1.5 * caustics(worldPos)));
                #endif
            }
        }
    #endif

    bloom_out = max(0.0, bloom_raw);
    ww_puddle_pbr(a, roughness, light.y, normal, worldPos);
    pbr_shading(a, bloom_out, viewPos, light.xyz, normal, roughness, metallic, f0 > 0.7 ? 0.0 : material.z, diffuse, translucent);


#if AMBIENT_OCCLUSION != AMBIENT_OCCLUSION_NONE
    float ao_shaded = 1.0 + min(0.0, bloom_raw);
    float ssao = mix(aoval, 1.0, min(bloom_out, 1.0));
    a.rgb *= ao_shaded * ssao;
#endif
    if (matflash) a.rgb += 1.0;
    if (mathurt) a.r += 0.5;

    a.a = min(1.0, a.a);

    // PERF: don't shade past max fog distance
    a = fog(frx_worldFlag(FRX_WORLD_HAS_SKYLIGHT) ? light.y * frx_ambientIntensity() : 1.0, a, viewPos, worldPos, bloom_out);

    #if CAUSTICS_MODE == CAUSTICS_MODE_TEXTURE
        if (frx_playerFlag(FRX_PLAYER_EYE_IN_FLUID) && translucentDepth >= depth) {
            a.rgb += light.y * light.y * 0.1 * v_sky_radiance * volumetric_caustics_beam(worldPos);
        }
    #endif

    return a;
}

vec4 ldr_shaded_particle(vec2 uv, sampler2D scolor, sampler2D sdepth, sampler2D slight, out float bloom_out)
{
    vec4 a = texture2D(scolor, uv);

    float depth     = texture2D(sdepth, uv).r;
    vec3  viewPos   = coords_view(uv, frx_inverseProjectionMatrix(), depth);
    vec3  normal    = normalize(-viewPos) * frx_normalModelMatrix();
    vec4  light     = texture2D(slight, uv);
    vec3  worldPos  = frx_cameraPos() + (frx_inverseViewMatrix() * vec4(viewPos, 1.0)).xyz;

    bloom_out = light.z;
    pbr_shading(a, bloom_out, viewPos, light.xyy, normal, 1.0, 0.0, 0.0, false, false);

    a.a = min(1.0, a.a);

    a = fog(frx_worldFlag(FRX_WORLD_HAS_SKYLIGHT) ? light.y * frx_ambientIntensity() : 1.0, a, viewPos, worldPos, bloom_out);

    return ldr_tonemap(a);
}

void main()
{
    float bloom1;
    float bloom2;
    float bloom3;
    float ssao = texture2D(u_ao, v_texcoord).r;
    float translucentDepth = texture2D(u_translucent_depth, v_texcoord).r;
    vec4 a1 = hdr_shaded_color(v_texcoord, u_solid_color, u_solid_depth, u_light_solid, u_normal_solid, u_material_solid, ssao, false, translucentDepth, bloom1);
    vec4 a2 = hdr_shaded_color(v_texcoord, u_translucent_color, u_translucent_depth, u_light_translucent, u_normal_translucent, u_material_translucent, 1.0, true, 1.0, bloom2);
    vec4 a3 = ldr_shaded_particle(v_texcoord, u_particles_color, u_particles_depth, u_light_particles, bloom3);
    gl_FragData[0] = a1;
    gl_FragData[1] = a2;
    gl_FragData[2] = a3;
    gl_FragData[3] = vec4(bloom1 + bloom2 + bloom3, 0.0, 0.0, 1.0);
}


