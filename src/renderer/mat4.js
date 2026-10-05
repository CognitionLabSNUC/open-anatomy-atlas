// Minimal 4x4 matrix / vec3 math library (column-major, Float32Array), zero dependencies.
const mat4 = {
  create() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  },
  identity(out) {
    out.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    return out;
  },
  multiply(out, a, b) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3];
    const a10=a[4],a11=a[5],a12=a[6],a13=a[7];
    const a20=a[8],a21=a[9],a22=a[10],a23=a[11];
    const a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let i=0;i<4;i++) {
      const b0=b[i*4],b1=b[i*4+1],b2=b[i*4+2],b3=b[i*4+3];
      out[i*4]   = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      out[i*4+1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      out[i*4+2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      out[i*4+3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    }
    return out;
  },
  translate(out, a, v) {
    const t = mat4.create();
    t[12]=v[0]; t[13]=v[1]; t[14]=v[2];
    return mat4.multiply(out, a, t);
  },
  scale(out, a, v) {
    const s = mat4.create();
    s[0]=v[0]; s[5]=v[1]; s[10]=v[2];
    return mat4.multiply(out, a, s);
  },
  rotateX(out, a, rad) {
    const c=Math.cos(rad), s=Math.sin(rad);
    const r = mat4.create();
    r[5]=c; r[6]=s; r[9]=-s; r[10]=c;
    return mat4.multiply(out, a, r);
  },
  rotateY(out, a, rad) {
    const c=Math.cos(rad), s=Math.sin(rad);
    const r = mat4.create();
    r[0]=c; r[2]=-s; r[8]=s; r[10]=c;
    return mat4.multiply(out, a, r);
  },
  rotateZ(out, a, rad) {
    const c=Math.cos(rad), s=Math.sin(rad);
    const r = mat4.create();
    r[0]=c; r[1]=s; r[4]=-s; r[5]=c;
    return mat4.multiply(out, a, r);
  },
  perspective(out, fovy, aspect, near, far) {
    const f = 1.0/Math.tan(fovy/2);
    out.fill(0);
    out[0]=f/aspect; out[5]=f;
    out[10]=(far+near)/(near-far); out[11]=-1;
    out[14]=(2*far*near)/(near-far);
    return out;
  },
  lookAt(out, eye, center, up) {
    const z = normalize(sub(eye, center));
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    out[0]=x[0]; out[1]=y[0]; out[2]=z[0]; out[3]=0;
    out[4]=x[1]; out[5]=y[1]; out[6]=z[1]; out[7]=0;
    out[8]=x[2]; out[9]=y[2]; out[10]=z[2]; out[11]=0;
    out[12]=-dot(x,eye); out[13]=-dot(y,eye); out[14]=-dot(z,eye); out[15]=1;
    return out;
  },
  invert(out, a) {
    const m = a;
    const a00=m[0],a01=m[1],a02=m[2],a03=m[3];
    const a10=m[4],a11=m[5],a12=m[6],a13=m[7];
    const a20=m[8],a21=m[9],a22=m[10],a23=m[11];
    const a30=m[12],a31=m[13],a32=m[14],a33=m[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10;
    const b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
    const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30;
    const b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return null;
    det = 1.0/det;
    out[0]=(a11*b11-a12*b10+a13*b09)*det;
    out[1]=(a02*b10-a01*b11-a03*b09)*det;
    out[2]=(a31*b05-a32*b04+a33*b03)*det;
    out[3]=(a22*b04-a21*b05-a23*b03)*det;
    out[4]=(a12*b08-a10*b11-a13*b07)*det;
    out[5]=(a00*b11-a02*b08+a03*b07)*det;
    out[6]=(a32*b02-a30*b05-a33*b01)*det;
    out[7]=(a20*b05-a22*b02+a23*b01)*det;
    out[8]=(a10*b10-a11*b08+a13*b06)*det;
    out[9]=(a01*b08-a00*b10-a03*b06)*det;
    out[10]=(a30*b04-a31*b02+a33*b00)*det;
    out[11]=(a21*b02-a20*b04-a23*b00)*det;
    out[12]=(a11*b07-a10*b09-a12*b06)*det;
    out[13]=(a00*b09-a01*b07+a02*b06)*det;
    out[14]=(a31*b01-a30*b03-a32*b00)*det;
    out[15]=(a20*b03-a21*b01+a22*b00)*det;
    return out;
  },
  transpose(out, a) {
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) out[i*4+j]=a[j*4+i];
    return out;
  }
};
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function normalize(a){const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];}

if (typeof module !== 'undefined') module.exports = { mat4, sub, cross, dot, normalize };
