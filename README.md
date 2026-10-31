# Lurching Llama 🦙

A wobbly obstacle-course party race through an alpine meadow, in the browser. You're a very
top-heavy llama with a ridiculously long, springy neck. You set off quickly but stop slowly:
brake and your whole body lurches on, the neck flinging forward and dragging you with it. Keep
your head over your hooves, dodge the obstacles, and wobble to the finish ahead of seven bot
llamas.

**Play it online:** https://alecsharpie.github.io/lurching-llama/

## Play

It's plain ES modules (three.js from a CDN), so it just needs a static web server:

```bash
cd lurching-llama
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` straight from disk won't work: browsers block module imports over `file://`.)

### Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move (relative to the camera) |
| Space | Jump (tap for a hop, hold for a full jump) · mash it while knocked over to get up faster |
| C (or Q / Ctrl) | Duck your neck under high bars |
| Mouse | Look around (click to capture the mouse, Esc to release) |
| R | Back to the last checkpoint |
| M | Mute |
| P | Pause (releasing the mouse with Esc also pauses) |

Touch devices get an on-screen joystick and buttons. Gamepads work too: left stick to move, right
stick to look, A to jump (and to confirm in menus), B, X, LB or RB to duck, Start to pause, Back/View
to respawn.

**Balancing:** there's no meter; watch the llama. Its body tips the way its neck is leaning,
its eyes go wide and it starts sweating when it's close to going over. Ease off before you
stop, and if the neck is tipping, *move toward the lean* to get back under it, the same way
you'd balance a broom on your hand. Tip too far and over you go.

## Modes

- **Quick Race**: one race on the course you picked, against seven bots.
- **Play Show**: three rounds, 8 → 5 → 3 → 1. Round 1 is the Wobbly Gauntlet (top 5 qualify;
  the round ends the moment the 5th finishes), round 2 is Duck Duck Llama (top 3), and the final
  is Log Roll Rumble, where first across the line takes the crown. Win a Show to unlock the Golden Crown hat.

## The courses


**The Wobbly Gauntlet.** Spinning sweepers (jump the low red bar, duck the high blue one) → sliding rafts over
the lake → hay-bale hill → toadstool bounce pads and windy balance beams by the windmills → swinging hay-bale hammers → spinning
millstones → teeter-totters that tip under your weight (your heavy head counts!) → finish.

**Log Roll Rumble.** A conveyor belt with sliding pushers → a treadmill of giant rolling logs →
a tilting disc on a ball joint → bobbing elevators up to a plateau → bounce pads to the top deck
→ sweeper finale → finish.

**Duck Duck Llama.** A course about the neck: a corridor of head-height bars to duck (hold C)
and shin-height hurdles to jump → three lanes of stepping stones that sink while you stand on
them → a ramp with pendulums swinging at head height (duck and they pass over you) → a catwalk
of bars → finish.

All courses have checkpoints. On the title screen pick a course, how wobbly your neck is
(Chill, Wobbly or Chaos; harder settings also sharpen the bots), your llama's coat, its saddle
blanket (tartan, stripes, polka dots, diamonds...) and a hat
(party hat, top hat, beanie, flower crown or propeller cap). Your choices and your best time on
each course are saved in the browser, and in Quick Race your best run comes back as a see-through
ghost llama to race against. The title screen also tracks Shows played, Crowns and Quick Race wins.

## How the llama works

Everything is procedural, with no model files or animation clips:

- **Momentum**: speeding up is snappy but braking and turning are not (`integrate` in
  `src/llama.js`), and the further the head leans the harder it hauls the body along. The
  barrel is a spring on its planted hooves, so it surges, nose-dives and swings wide.
- **Neck**: gameplay-wise it's a springy inverted pendulum (`updateBalance` in `src/llama.js`)
  driven by the body's measured acceleration, with braking throwing it much harder than
  setting off. Visually it's a 10-vertebra chain of jiggle
  springs, with one continuous fleece tube skinned over it every frame (`NeckTube`), and a
  head that stabilises itself to stay level.
- **Legs**: two-bone IK per leg, with the knee pole forward for front legs and the hock pole
  backward for hind legs. Feet stay planted during stance and swing along arcs to predicted
  landing spots. The gait blends from a lateral-sequence walk to a pace to a rocking gallop as
  speed rises, which is how camelids actually move. Feet step on their own when turning on
  the spot or when shoved.
- **Fleece**: displaced, noise-curled icosphere "wool" with crevice shading baked into vertex
  colours.
- **Secondary motion**: springy ears with pompoms, blanket tassels, tail, blinking, sideways
  cud chewing, squash and stretch, breathing, and a panic face when you're about to topple.
  Ears pin back when a llama is annoyed, idle llamas glance at their neighbours, and a llama
  left standing for a few seconds gives a big yawn.
- **Blanket**: draped by raycasting onto the fleece, so it sits on the wool instead of floating.

## Files

- `index.html`: page, HUD, menus and styles
- `src/main.js`: game loop, camera, input, bots, race flow, effects
- `src/llama.js`: the llama: model, balance physics, gait, IK and procedural animation
- `src/course.js`: platforms, obstacles, wind and collision queries
- `src/meadow.js`: procedural meadow textures, mountains, pines and other scenery
- `src/audio.js`: synthesised sound effects and music
- `src/util.js`: noise, wool geometry and helpers
