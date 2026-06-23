// =============================================================================
// PostFX.js  -  포스트 프로세싱 셰이더 (ChronosOverload 스타일)
// -----------------------------------------------------------------------------
//  - ChromaticAberrationPostFX: 화면 중심에서 멀수록 RGB가 어긋나는 색수차.
//    평소엔 아주 약하게, 발사/피격 같은 순간에 intensity 를 키워 펄스를 준다.
//  - Vignette / Bloom 은 Phaser 내장 postFX(addVignette/addBloom)를 사용한다.
// =============================================================================

const fragShader = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform float uIntensity;

varying vec2 outTexCoord;

void main() {
  vec2 dir = outTexCoord - vec2(0.5);
  float dist = length(dir);
  vec2 offset = dir * dist * uIntensity;

  float r = texture2D(uMainSampler, outTexCoord + offset).r;
  float g = texture2D(uMainSampler, outTexCoord).g;
  float b = texture2D(uMainSampler, outTexCoord - offset).b;
  float a = texture2D(uMainSampler, outTexCoord).a;

  gl_FragColor = vec4(r, g, b, a);
}
`;

export class ChromaticAberrationPostFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name: 'ChromaticAberrationPostFX', fragShader });
    this._intensity = 0;
  }

  get intensity() { return this._intensity; }
  set intensity(value) { this._intensity = value; }

  onPreRender() {
    this.set1f('uIntensity', this._intensity);
  }
}
