#include frex:shaders/api/fragment.glsl
#include frex:shaders/lib/math.glsl

/******************************************************
  canvas:shaders/material/warm_glow.frag
******************************************************/

void frx_startFragment(inout frx_FragmentData fragData) {
	float e = frx_luminance(fragData.spriteColor.rgb);
	bool lit = e >  2.0 || (fragData.spriteColor.r - fragData.spriteColor.g) > 0.1f;
	fragData.emissivity = lit ? e : 0.0;
	fragData.diffuse = fragData.diffuse && !lit;
	fragData.ao = fragData.ao && !lit;
}
