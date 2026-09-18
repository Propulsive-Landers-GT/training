import json, html, re, os

BUILD = os.path.dirname(os.path.abspath(__file__))
copy = json.load(open(os.path.join(BUILD, "copy.json"), encoding="utf-8"))
diagrams = open(os.path.join(BUILD, "diagrams.html"), encoding="utf-8").read()

S = {s["id"]: s for s in copy["sections"]}
esc = lambda t: html.escape(t, quote=False)

def fig(fid, caption=None):
    m = re.search(r'<figure class="diagram[^"]*" id="%s">.*?</figure>' % fid, diagrams, re.S)
    f = m.group(0)
    if caption is not None:
        f = re.sub(r"<figcaption>.*?</figcaption>", "<figcaption>%s</figcaption>" % esc(caption), f, flags=re.S)
    return f

# ---- inline markup consumed here so copy.json stays plain prose ----
#   [[try:SIM k=v,k=v|label]]  -> a link that applies a scenario to a sim (page.js handles the click)
#   [[live:SIM.key|unit|digits]] -> a span page.js refreshes from the sim's read()
#   {{pull: ...}} at the start of a paragraph -> a pull-quote before it
#   {{note: ...}} at the end of a paragraph -> a margin note after it
def _val(v):
    v = v.strip()
    if v in ("true", "false"): return v == "true"
    try:
        return int(v) if re.fullmatch(r"-?\d+", v) else float(v)
    except ValueError:
        return v

def _try(m):
    sim, args, label = m.group(1), m.group(2) or "", m.group(3)
    sc = {}
    for kv in filter(None, (x.strip() for x in args.split(","))):
        k, _, v = kv.partition("=")
        sc[k.strip()] = _val(v) if _ else True
    data = json.dumps(sc, separators=(",", ":"))
    assert "'" not in data, data
    return ('<a class="try-link" href="#" data-sim="%s" data-apply=\'%s\'>%s<span class="try-arrow"></span></a>'
            % (sim, data, label))

def _live(m):
    sim, key, unit, digits = m.groups()
    return ('<span class="live" data-sim="%s" data-key="%s" data-unit="%s" data-digits="%s">—</span>'
            % (sim, key, unit, digits))

def rich(text):
    t = esc(text)
    t = re.sub(r"\[\[try:([a-z]+)\s*([^|\]]*)\|([^\]]+)\]\]", _try, t)
    t = re.sub(r"\[\[live:([a-z]+)\.([A-Za-z]+)\|([^|\]]*)\|(\d+)\]\]", _live, t)
    assert "[[" not in t, t
    return t

def para(p):
    """one paragraph, with an optional pull-quote before and margin note after"""
    out = []
    m = re.match(r"^\{\{pull:\s*(.*?)\}\}", p)
    if m:
        out.append('<p class="pull">%s</p>' % esc(m.group(1)))
        p = p[m.end():]
    m = re.search(r"\{\{note:\s*(.*?)\}\}\s*$", p)
    if m:
        p = p[:m.start()].rstrip()
        out.append('<div class="para-with-note"><p>%s</p><aside class="margin-note">%s</aside></div>' % (rich(p), esc(m.group(1))))
    else:
        out.append("<p>%s</p>" % rich(p))
    assert "{{" not in "".join(out), p
    return "\n".join(out)

def paras(ps):
    return "\n".join(para(p) for p in ps)

def instrument(name, captions):
    out = ['<div class="instrument" data-sim="%s"></div>' % name]
    for c in captions:
        out.append('<p class="caption">%s</p>' % esc(c))
    return "\n".join(out)

def try_block(items):
    lis = "\n".join("  <li>%s</li>" % esc(i) for i in items)
    return '<div class="try"><span class="eyebrow">Try this</span>\n<ol>\n%s\n</ol></div>' % lis

def predict(pr):
    """predict-then-check: a question, options, a hidden reveal, and optionally a scenario to apply"""
    attrs = ""
    if pr.get("apply"):
        data = json.dumps(pr["apply"]["scenario"], separators=(",", ":"))
        assert "'" not in data, data
        attrs = ' data-sim="%s" data-apply=\'%s\'' % (pr["apply"]["sim"], data)
    opts = "\n".join('    <button type="button" class="btn btn-ghost"%s>%s</button>'
                     % (' data-correct="1"' if o.get("correct") else "", esc(o["label"])) for o in pr["options"])
    return ('<div class="predict"%s><span class="eyebrow">Predict</span>\n<p class="q">%s</p>\n<div class="opts">\n%s\n</div>\n'
            '<p class="reveal" hidden>%s</p></div>' % (attrs, esc(pr["q"]), opts, esc(pr["reveal"])))

# ---- controller card: where the reader is in the build-up ----
STAGES = ["Hand-fly", "Feedforward", "P", "PD", "PID", "FF + FB", "LQR", "MPC"]
NOW = {"open-loop": ["Feedforward"], "closed-loop": ["P", "PD", "PID"], "videos": [], "combine": ["FF + FB"], "lqr": ["LQR"], "mpc": ["MPC"]}
def build_strip(sid):
    now = NOW[sid]
    first = STAGES.index(now[0]) if now else STAGES.index("FF + FB")   # videos: everything up to PID is done
    lis = []
    for i, st in enumerate(STAGES):
        cls = "now" if st in now else "done" if i < first else ""
        lis.append('<li%s>%s</li>' % (' class="%s"' % cls if cls else "", esc(st)))
    return '<ol class="build" aria-label="Where this chapter sits in the build-up">%s</ol>' % "".join(lis)

# ---- loop strip: the four-box loop drawn once, with the chapter's box lit ----
def loop_strip(hot, label=None, open_loop=False):
    """hot: set of names among setpoint, controller, rocket, sensor, return"""
    boxes = ["setpoint", "controller", "rocket", "sensor"]
    bw, gap, x0, y, h = 58, 18, 7, 10, 20
    out = ['<svg class="loopstrip" viewBox="0 0 300 48" aria-hidden="true" focusable="false">']
    xs = {}
    for i, key in enumerate(boxes):
        x = x0 + i * (bw + gap)
        xs[key] = x
        hot_cls = " hot" if key in hot else ""
        out.append('<rect class="lbox%s" x="%d" y="%d" width="%d" height="%d" rx="2"/>' % (hot_cls, x, y, bw, h))
        out.append('<text class="ltext%s" x="%d" y="%d" text-anchor="middle">%s</text>' % (hot_cls, x + bw / 2, y + 14, key))
        if i < 3:
            ax0, ax1 = x + bw, x + bw + gap
            out.append('<path class="lwire" d="M%d %d H%d"/>' % (ax0, y + h / 2, ax1 - 4))
            out.append('<path class="lhead" d="M%d %d l-5 -3 v6 z"/>' % (ax1, y + h / 2))
    if label:
        out.append('<text class="ltext lsmall hot" x="%d" y="7" text-anchor="middle">%s</text>' % (xs["controller"] + bw / 2, esc(label)))
    # return path under the row: sensor bottom, down, left, up into the setpoint box
    sx = xs["sensor"] + bw / 2
    tx = xs["setpoint"] + bw / 2
    ry = y + h + 11
    rcls = "lwire lret" + (" dim" if open_loop else "") + (" hot" if "return" in hot else "")
    out.append('<path class="%s" d="M%d %d V%d H%d V%d"/>' % (rcls, sx, y + h, ry, tx, y + h + 5))
    if not open_loop:
        out.append('<path class="lhead%s" d="M%d %d l-3 5 h6 z"/>' % (" hot" if "return" in hot else "", tx, y + h + 1))
    out.append('</svg>')
    return "".join(out)

LOOPS = {
    "why-control": dict(hot={"sensor", "controller"}),
    "open-loop": dict(hot={"controller"}, open_loop=True),
    "closed-loop": dict(hot={"sensor", "return"}),
    "combine": dict(hot={"controller"}, label="FF + FB"),
    "lqr": dict(hot={"controller"}, label="K"),
    "mpc": dict(hot={"controller"}, label="N steps"),
}

def head(n, label, heading, sid=None):
    num = '<span class="n">%s</span>' % n if n else ""
    strip = loop_strip(**LOOPS[sid]) if sid in LOOPS else ""
    build = build_strip(sid) if sid in NOW else ""
    return ('<div class="chapter-head"><div class="head-text"><span class="eyebrow">%s%s</span>\n<h2>%s</h2></div>%s</div>%s'
            % (num, esc(label), esc(heading), strip, ("\n" + build) if build else ""))

def repo_note(inner_html):
    return '<aside class="repo-note"><span class="eyebrow">In the repo</span>%s</aside>' % inner_html

parts = []
A = parts.append

# ---------------- topbar ----------------
A('''<header class="topbar"><div class="wrap topbar-in">
  <a class="brand" href="#hero"><img class="mark" src="ASSET_MARK" alt=""><span>Propulsive Landers <b>/ GNC</b></span></a>
  <nav class="topnav" aria-label="Chapters">
    <a href="#why-control">Why</a>
    <a href="#open-loop">Feedforward</a>
    <a href="#closed-loop">Feedback</a>
    <a href="#combine">Both</a>
    <a href="#lqr">LQR</a>
    <a href="#mpc">MPC</a>
    <a href="#exercises">Exercises</a>
  </nav>
  <button class="theme-btn" id="themeBtn" type="button">Theme: auto</button>
</div></header>''')

A('<main class="wrap">')

# ---------------- hero ----------------
h = copy["hero"]
wc = S["why-control"]
A('<section class="hero" id="hero">\n<div class="prose">')
A('<span class="eyebrow">%s</span>' % esc(h["subtitle"]))
A('<h1>%s</h1>' % esc(h["title"]))
if h.get('byline'):
    A('<p class="hero-meta">%s</p>' % esc(h['byline']))
lede_parts = [x.strip() for x in h["lede"].split("\n\n") if x.strip()]
A('<p class="lead">%s</p>' % esc(lede_parts[0]))
A('</div>')
# the servo paragraph sits beside an animated figure of the three servos
A('<div class="hero-grid"><div class="prose">')
A(para(lede_parts[1]))
A('</div>')
A(open(os.path.join(BUILD, 'engine-figure.html'), encoding='utf-8').read().strip())
A('</div>')
A('<div class="prose">')
for _part in lede_parts[2:]:
    A(para(_part))
A(para(h["hook"]))
A('</div>')
A(instrument("handfly", [wc["captions"]["handHover"]]))
A('</section>')

# ---------------- 01 why-control ----------------
A('<section class="chapter" id="why-control">')
A(head("01", "Why control", wc["heading"], "why-control"))
A('<div class="prose">')
A(paras(wc["paragraphs"][:4]))
A('</div>')
A(fig("fig-loops"))
A('<div class="prose">')
A(paras(wc["paragraphs"][4:]))
A('</div>')
A(try_block(wc["tryThis"]))
A(predict(wc["predict"]))
A('</section>')

# ---------------- 02 open-loop ----------------
s = S["open-loop"]
A('<section class="chapter" id="open-loop">')
A(head("02", "Feedforward", s["heading"], "open-loop"))
A('<div class="prose">')
A(paras(s["paragraphs"][:2]))
A('</div>')
A(instrument("openloop", [s["captions"]["feedforward"]]))
A(try_block(s["tryThis"]))
A('<div class="prose">')
A(paras(s["paragraphs"][2:]))
A('</div>')
A(predict(s["predict"]))
A('</section>')

# ---------------- 03 closed-loop ----------------
s = S["closed-loop"]
A('<section class="chapter" id="closed-loop">')
A(head("03", "Feedback", s["heading"], "closed-loop"))
A('<div class="prose">')
A(paras(s["paragraphs"][:1]))
A('</div>')
A(instrument("pid", [s["captions"]["pid"]]))
A('<div class="prose">')
A(paras(s["paragraphs"][1:]))
A('</div>')
A(try_block(s["tryThis"]))
A(predict(s["predict"]))
A('</section>')

# ---------------- 04 videos ----------------
s = S["videos"]
videos = [
    ("4:40", "Controlling Self Driving Cars", "AerospaceControlsLab", "https://www.youtube.com/watch?v=4Y7zG48uHRo",
     "A car steering onto a lane line. P alone oscillates, PD damps it, PID removes the offset. No math."),
    ("7:44", "PID Control - A brief introduction", "Brian Douglas", "https://www.youtube.com/watch?v=UR0hOmjaHp0",
     "Hand-drawn intuition for what each of the three terms is for."),
    ("15:44", "What Is Feedforward Control? | Control Systems in Practice", "MATLAB", "https://www.youtube.com/watch?v=FW_ay7K4jPE",
     "Anticipation versus correction. Feedforward takes the predictable part so feedback only cleans up model error. Sets up the next section."),
    ("13:03", "Linear Quadratic Regulator (LQR) Control for the Inverted Pendulum on a Cart [Control Bootcamp]", "Steve Brunton", "https://www.youtube.com/watch?v=1_UobILf3cc",
     "Balancing a pole while moving the cart is tilting to translate, the closest textbook stand-in for a rocket."),
    ("4:50", "Why Use Model Predictive Control? | Understanding MPC, Part 1", "MATLAB", "https://www.youtube.com/watch?v=8U0xiOkDcmw",
     "Many inputs, hard limits, and looking ahead: the three reasons Monarch wants MPC."),
    ("1:36", "Grasshopper 744m Test | Single Camera (Hexacopter)", "SpaceX", "https://www.youtube.com/watch?v=9ZDkItO-0a4",
     "A real hop with a sideways move. Watch the gimbal tilt the vehicle before it translates."),
]
A('<section class="chapter" id="videos">')
A(head("04", "Videos", s["heading"], "videos"))
A('<div class="prose">')
A(paras(s["paragraphs"]))
A('</div>')
A('<ul class="videos">')
for dur, title, chan, url, why in videos:
    A('  <li><a class="vid" href="%s" target="_blank" rel="noopener"><span class="dur">%s</span>'
      '<span class="t">%s<span class="m">%s</span></span><span class="why">%s</span></a></li>'
      % (url, dur, esc(title), esc(chan), esc(why)))
A('</ul>')
A('</section>')

# ---------------- 05 combine ----------------
s = S["combine"]
A('<section class="chapter" id="combine">')
A(head("05", "Feedforward and feedback", s["heading"], "combine"))
A('<div class="prose">')
A(paras(s["paragraphs"][:1]))
A('</div>')
A(instrument("ffb", [s["captions"]["ffPlusFb"]]))
A(try_block(s["tryThis"]))
A('<div class="prose">')
A(paras(s["paragraphs"][1:]))
A('</div>')
A(predict(s["predict"]))
A('</section>')

# ---------------- 06 lqr ----------------
s = S["lqr"]
A('<section class="chapter advanced" id="lqr">')
A(head("06", "LQR", s["heading"], "lqr"))
if s.get('note'):
    A('<p class="chapter-note">%s</p>' % esc(s['note']))
A('<div class="prose">')
A(paras(s["paragraphs"][:2]))
A(fig("fig-tilt"))
A(paras(s["paragraphs"][2:4]))
A('</div>')
A(instrument("lqr", []))
A(try_block(s["tryThis"]))
A('<div class="prose">')
A(paras(s["paragraphs"][4:]))
A('</div>')
A(predict(s["predict"]))
A('</section>')

# ---------------- 07 mpc ----------------
s = S["mpc"]
P = s["paragraphs"]
# paragraphs 4..9 (0-based) are the numbered function walk-through; render as an <ol>
first = next(i for i, x in enumerate(P) if re.match(r"^1\.\s", x))
last = first
while last + 1 < len(P) and re.match(r"^\d+\.\s", P[last + 1]): last += 1
steps = [re.sub(r"^\d+\.\s+", "", x) for x in P[first:last + 1]]
A('<section class="chapter advanced" id="mpc">')
A(head("07", "MPC", s["heading"], "mpc"))
if s.get('note'):
    A('<p class="chapter-note">%s</p>' % esc(s['note']))
A('<div class="prose">')
A(paras(P[:2]))
A(fig("fig-warm"))
A(paras(P[2:first - 1]))
A('</div>')
A(instrument("mpc", []))
A(try_block(s["tryThis"]))
A('<div class="prose">')
A(paras(P[first - 1:first]))
A('<ol>\n%s\n</ol>' % "\n".join("  <li>%s</li>" % esc(x) for x in steps))
A(paras(P[last + 1:]))
A('</div>')
A(predict(s["predict"]))
A('</section>')

# ---------------- 08 fits ----------------
s = S["fits"]
A('<section class="chapter" id="fits">')
A(head("08", "GNC", s["heading"]))
A('<div class="prose">')
A(paras(s["paragraphs"]))
A('</div>')
A(fig("fig-gnc", s["captions"]["gncLoop"]))
A(try_block(s["tryThis"]))
A('''<figure class="monarch">
  <img src="ASSET_MONARCH" alt="Render of Monarch, GTPL's 1000 N hybrid lander: three tanks around a central column, a gimbaled engine below, four legs">
  <ol class="callouts">
    <li><span class="n">01</span><span><b>Throttle valve</b>on the oxidizer line. One servo. This is the thrust command.</span></li>
    <li><span class="n">02</span><span><b>Gimbaled engine</b>two servos. This is the pair of gimbal angle commands.</span></li>
    <li><span class="n">03</span><span><b>Three tanks</b>mass changes as they drain, so hover thrust changes during the burn.</span></li>
    <li><span class="n">04</span><span><b>Avionics</b>with the IMU up top. Where the state estimate starts.</span></li>
  </ol>
</figure>''')
A('</section>')

# ---------------- 09 exercises ----------------
s = S["exercises"]
files = {
    "exercises/ex1_hover_pid.py": "exercises/ex1_hover_pid.py",
    "exercises/ex2_lqr_tvc.py": "exercises/ex2_lqr_tvc.py",
    "exercises/ex3_mpc_receding_horizon.py": "exercises/ex3_mpc_receding_horizon.py",
}
def link_files(text):
    t = esc(text)
    for f in files:
        t = t.replace(f, '<a href="%s"><code>%s</code></a>' % (f, f))
    return t

A('<section class="chapter" id="exercises">')
A(head("09", "Exercises", s["heading"]))
A('<div class="prose">')
A(paras(s["paragraphs"]))
A('</div>')
A(repo_note('Starter files, a small grader and setup notes live in <code>exercises/</code>. '
            'Read <a href="exercises/README.md"><code>exercises/README.md</code></a> first.'))
A('<ol class="exercises">')
for ex in copy["exercises"]:
    A('  <li class="ex">')
    A('    <h3>%s</h3>' % esc(ex["title"]))
    A('    <p class="meta">%s</p>' % link_files(ex["meta"]))
    A('    <p class="goal">%s</p>' % esc(ex["goal"]))
    A('    <ol>')
    for st in ex["steps"]:
        A('      <li>%s</li>' % link_files(st))
    A('    </ol>')
    A('    <p class="submit"><b>Submit:</b> %s</p>' % esc(ex["submit"]))
    A('    <p class="stretch"><b>Stretch:</b> %s</p>' % esc(ex["stretch"]))
    A('  </li>')
A('</ol>')
A('</section>')

# ---------------- further ----------------
s = S["further"]
A('<section class="chapter" id="further">')
A(head(None, "Further reading", s["heading"]))
A('<div class="prose">')
A(paras(s["paragraphs"]))
A('</div>')
A('<ul class="further">')
for f in copy["further"]:
    A('  <li><div class="t"><a href="%s" target="_blank" rel="noopener">%s</a></div><div class="w">%s</div></li>'
      % (f["url"], esc(f["title"]), esc(f["why"])))
A('</ul>')
A('</section>')

A('</main>')

# ---------------- footer ----------------
A('''<footer><div class="wrap">
  <p>Propulsive Landers @ Georgia Tech · GNC subteam · questions in #gnc on Discord</p>
  <p><a href="https://gtpropulsivelanders.org/" target="_blank" rel="noopener">gtpropulsivelanders.org</a> · <a href="https://github.com/Propulsive-Landers-GT" target="_blank" rel="noopener">the team on GitHub</a></p>
  <p>The tune-feedforward-first progression and the noise and disturbance toggles are borrowed from the WPILib controls tuning tutorials (<a href="https://github.com/wpilibsuite/wpilib-docs" target="_blank" rel="noopener">wpilibsuite/wpilib-docs</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>). The simulations here are our own.</p>
</div></footer>''')

out = "\n".join(parts) + "\n"
open(os.path.join(BUILD, "sections.html"), "w", encoding="utf-8", newline="\n").write(out)
print("wrote", len(out), "bytes")
