# 예배송출 기본 배경 영상 만들기 — 모든 움직임이 주기 T 로 딱 맞아 끝과 처음이 이어짐
import sys, subprocess, numpy as np
T, FPS = 20.0, 24
N = int(T * FPS)
W, H = 640, 360
u = np.linspace(0, 1, W)[None, :]
v = np.linspace(0, 1, H)[:, None]
asp = W / H
rng = np.random.default_rng(7)
TAU = 2 * np.pi

def blob(cx, cy, r):
    return np.exp(-(((u - cx) * asp) ** 2 + (v - cy) ** 2) / (r * r))

def golden(p):
    img = np.zeros((H, W, 3))
    img += np.array([0.07, 0.04, 0.02]) * (1 - v * 0.6)[..., None]
    for b in GB:
        cx = b['x'] + 0.06 * np.sin(b['fx'] * p + b['ph'])
        cy = b['y'] + 0.05 * np.cos(b['fy'] * p + b['ph'] * 1.3)
        a = b['a'] * (0.65 + 0.35 * np.sin(b['fa'] * p + b['ph'] * 2))
        img += blob(cx, cy, b['r'])[..., None] * a * b['c']
    return img
GB = [dict(x=rng.uniform(.05, .95), y=rng.uniform(.1, .9), r=rng.uniform(.04, .14), fx=rng.integers(1, 3), fy=rng.integers(1, 3),
           fa=rng.integers(1, 4), ph=rng.uniform(0, TAU), a=rng.uniform(.10, .26),
           c=np.array([1.0, rng.uniform(.62, .80), rng.uniform(.25, .40)])) for _ in range(16)]

def waves(p):
    img = np.zeros((H, W, 3)) + np.array([0.01, 0.04, 0.09]) + np.array([0.0, 0.03, 0.07]) * v[..., None]
    for i, (f, k, y0, amp, c) in enumerate([(1.2, 1, .38, .05, (.10, .35, .60)), (2.0, -2, .52, .04, (.12, .45, .70)),
                                             (1.6, 1, .66, .06, (.08, .30, .55)), (2.6, -1, .78, .035, (.15, .50, .75))]):
        yc = y0 + amp * np.sin(TAU * f * u + k * p + i) + 0.02 * np.sin(TAU * 3 * u - 2 * k * p)
        d = v - yc
        band = np.exp(-(d / 0.012) ** 2) * 0.55 + np.exp(-(d / 0.06) ** 2) * 0.25
        img += band[..., None] * np.array(c) * 0.55
    return img

def aurora(p):
    img = np.zeros((H, W, 3)) + np.array([0.03, 0.01, 0.07]) * (1.2 - v)[..., None]
    for (y0, a, b, k, m, c, s) in [(.34, 1.5, 3, 1, -1, (.55, .25, .85), .9), (.46, 1.0, 5, -1, 2, (.20, .55, .70), .6),
                                   (.28, 2.0, 2, 2, 1, (.75, .30, .70), .5)]:
        yc = y0 + 0.07 * np.sin(TAU * a * u + k * p) + 0.03 * np.sin(TAU * 2.5 * u - k * p + 1)
        d = v - yc
        curtain = np.where(d > 0, np.exp(-(d / 0.20) ** 2), np.exp(-(d / 0.025) ** 2))
        ray = 0.55 + 0.45 * np.sin(TAU * b * u + m * p) * np.sin(TAU * 7 * u - m * p + 2)
        img += (curtain * ray * s * 0.38)[..., None] * np.array(c)
    return img

STARS = [(rng.uniform(0, 1), rng.uniform(0, .55), rng.uniform(0, TAU), rng.integers(1, 4)) for _ in range(70)]
def dawn(p):
    top, mid, bot = np.array([0.02, 0.03, 0.10]), np.array([0.10, 0.08, 0.20]), np.array([0.42, 0.20, 0.12])
    t = v[..., None]
    img = np.where(t < .6, top + (mid - top) * (t / .6), mid + (bot - mid) * ((t - .6) / .4)) * np.ones((1, W, 1))
    # 천천히 흐르는 구름 (가로로 한 바퀴 = T)
    cl = sum(np.sin(TAU * (f * u + g * p / TAU) + q) * w for f, g, q, w in [(1, 1, 0, .5), (2, 1, 1.7, .3), (3, -1, 4.1, .2), (5, 2, 2.2, .12)])
    band = np.exp(-((v - .68) / .10) ** 2)
    img += (np.clip(cl, 0, None) * band * 0.10)[..., None] * np.array([1.0, .65, .55])
    for x, y, ph, f in STARS:
        tw = 0.5 + 0.5 * np.sin(f * p + ph)
        img += (blob(x, y, .004) * 0.35 * tw * (1 - y / .55))[..., None]
    return img

PART = [dict(x=rng.uniform(0, 1), y=rng.uniform(0, 1), sp=rng.integers(1, 3), sw=rng.uniform(.005, .02),
             fs=rng.integers(1, 4), ph=rng.uniform(0, TAU), r=rng.uniform(.004, .012), a=rng.uniform(.25, .7)) for _ in range(70)]
def particles(p):
    img = np.zeros((H, W, 3)) + np.array([0.02, 0.03, 0.08]) + np.array([0.04, 0.03, 0.05]) * v[..., None]
    img += (np.exp(-((v - 1.1) / .5) ** 2) * 0.12)[..., None] * np.array([1.0, .7, .4])
    for q in PART:
        y = (q['y'] - q['sp'] * p / TAU) % 1.0 * 1.1 - 0.05
        x = q['x'] + q['sw'] * np.sin(q['fs'] * p + q['ph'])
        fade = np.sin(np.pi * np.clip((y + 0.05) / 1.1, 0, 1))
        img += (blob(x, y, q['r']) * q['a'] * fade)[..., None] * np.array([1.0, .85, .55])
    return img

FN = dict(golden=golden, waves=waves, aurora=aurora, dawn=dawn, particles=particles)
name, out = sys.argv[1], sys.argv[2]
ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                       '-vf', 'scale=1280:720:flags=lanczos,noise=alls=4:allf=t,format=yuv420p',
                       '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'grain', '-g', str(FPS * 2), '-an', '-movflags', '+faststart', out],
                      stdin=subprocess.PIPE)
for n in range(N):
    img = FN[name](TAU * n / N)
    ff.stdin.write((np.clip(img, 0, 1) ** (1 / 1.1) * 255).astype(np.uint8).tobytes())
ff.stdin.close(); ff.wait()
