#include lumi:shaders/context/post/header.glsl
#include lumi:shaders/post/reflection_common.glsl

/*******************************************************
 *  lumi:shaders/post/kaleidoskop.frag        *
 *******************************************************
 *  Copyright (c) 2020-2021 spiralhalo                 *
 *  Released WITHOUT WARRANTY under the terms of the   *
 *  GNU Lesser General Public License version 3 as     *
 *  published by the Free Software Foundation, Inc.    *
 *******************************************************/

uniform sampler2D u_solid_color;
uniform sampler2D u_solid_albedo;
uniform sampler2D u_solid_depth;
uniform sampler2D u_light_solid;
uniform sampler2D u_normal_solid;
uniform sampler2D u_material_solid;

uniform sampler2D u_translucent_color;
uniform sampler2D u_translucent_albedo;
uniform sampler2D u_translucent_depth;
uniform sampler2D u_light_translucent;
uniform sampler2D u_normal_translucent;
uniform sampler2D u_material_translucent;

const float JITTER_STRENGTH = 0.2;
const vec3 UP_VECTOR = vec3(0.0, 1.0, 0.0);

vec4 work_on_pair(
    in vec4 base_color,
    in vec3 albedo,
    in sampler2D reflector_depth,
    in sampler2D reflector_light,
    in sampler2D reflector_normal,
    in sampler2D reflector_material,

    in sampler2D reflected_color,
    in sampler2D reflected_depth,
    in sampler2D reflected_normal,
    float fallback
)
{
    vec4 noreturn = vec4(0.0);
    vec4 material = texture2D(reflector_material, v_texcoord);
    vec3 worldNormal = coords_normal(v_texcoord, reflector_normal);
    float roughness = material.x == 0.0 ? 1.0 : material.x; //prevent gloss on unmanaged draw
    float gloss   = 1.0 - roughness;
    if (gloss > 0.01 && material.a > 0.0) {
        vec3 ray_view  = coords_view(v_texcoord, frx_inverseProjectionMatrix(), reflector_depth);
        vec3 ray_world = coords_world(ray_view, frx_inverseViewMatrix());
        vec3 jitter    = 2.0 * vec3(frx_noise2d(ray_world.yz), frx_noise2d(ray_world.zx), frx_noise2d(ray_world.xy)) - 1.0;
        vec3 normal    = frx_normalModelMatrix() * normalize(worldNormal);
        float roughness2 = roughness * roughness;
        // if (ray_view.y < normal.y) return noreturn;
        vec3 unit_view  = normalize(-ray_view);
        vec3 unit_march = normalize(reflect(-unit_view, normal) + mix(vec3(0.0, 0.0, 0.0), jitter * JITTER_STRENGTH, roughness2));
        float sky_light = texture2D(reflector_light, v_texcoord).y;
        vec3 reg_f0     = vec3(material.y < 0.7 ? material.y : 0.0);
        vec3 f0         = mix(reg_f0, albedo, material.y);
        rt_Result result = rt_reflection(ray_view, unit_view, normal, unit_march, frx_normalModelMatrix(), frx_projectionMatrix(), frx_inverseProjectionMatrix(), reflector_depth, reflector_normal, reflected_depth, reflected_normal);
        vec4 reflected;
        float reflected_depth_value = coords_depth(result.reflected_uv, reflected_depth);
        if (reflected_depth_value == 1.0 || !result.hit || result.reflected_uv.x < 0.0 || result.reflected_uv.y < 0.0 || result.reflected_uv.x > 1.0 || result.reflected_uv.y > 1.0) {
            reflected.rgb = v_skycolor * frx_ambientIntensity() * l2_clampScale(-1.0, 1.0, dot(worldNormal, UP_VECTOR));
            reflected.rgb *= result.hits > 1 ? 0.1 : 1.0;
            reflected.rgb *= fallback;
            reflected.a = fallback;
        } else {
            reflected = texture2D(reflected_color, result.reflected_uv);
        }
        return vec4(pbr_lightCalc(roughness, f0, reflected.rgb * base_color.a, unit_march * frx_normalModelMatrix(), unit_view * frx_normalModelMatrix()), reflected.a);
    } else return noreturn;
}

void main()
{
    vec4 solid_base = texture2D(u_solid_color, v_texcoord);
    vec3 solid_albedo = texture2D(u_solid_albedo, v_texcoord).rgb;
    vec4 translucent_base = texture2D(u_translucent_color, v_texcoord);
    vec3 translucent_albedo = texture2D(u_translucent_albedo, v_texcoord).rgb;
    vec4 solid_solid       = work_on_pair(solid_base, solid_albedo, u_solid_depth, u_light_solid, u_normal_solid, u_material_solid, u_solid_color, u_solid_depth, u_normal_solid, 1.0);
    vec4 solid_translucent = work_on_pair(solid_base, solid_albedo, u_solid_depth, u_light_solid, u_normal_solid, u_material_solid, u_translucent_color, u_translucent_depth, u_normal_translucent, 0.0);
    vec4 translucent_solid       = work_on_pair(translucent_base, translucent_albedo, u_translucent_depth, u_light_translucent, u_normal_translucent, u_material_translucent, u_solid_color, u_solid_depth, u_normal_solid, 1.0);
    vec4 translucent_translucent = work_on_pair(translucent_base, translucent_albedo, u_translucent_depth, u_light_translucent, u_normal_translucent, u_material_translucent, u_translucent_color, u_translucent_depth, u_normal_translucent, 0.0);
    float roughness1 = texture2D(u_material_solid, v_texcoord).x;
    float roughness2 = texture2D(u_material_translucent, v_texcoord).x;
    gl_FragData[0] = vec4(solid_solid.rgb * (1.0 - solid_translucent.a) + solid_translucent.rgb, roughness1);
    gl_FragData[1] = vec4(translucent_solid.rgb * (1.0 - translucent_translucent.a) + translucent_translucent.rgb, roughness2);
}
