# GNC onboarding

Onboarding guides for the guidance, navigation and control subteam of Propulsive Landers
at Georgia Tech. Published with GitHub Pages at https://propulsive-landers-gt.github.io/training/

| Guide | What it is |
| --- | --- |
| [controls/](controls/) | Control, from the ground up: an interactive page (hand-fly, feedforward, PID, LQR, MPC) with six simulations, plus three take-home exercises that plug into [control](https://github.com/Propulsive-Landers-GT/control). |

## Doing the exercises

Fork this repo, work on a branch, put your work under `controls/submissions/<your-github-handle>/`
and open a pull request. Exercises 2 and 3 also want a clone of the `control` repo next to this one
(or point `CONTROL_REPO` at one). Details in [controls/exercises/README.md](controls/exercises/README.md).

## Editing a guide

Each guide folder has a `README.md` explaining how it is built. The controls guide is a single
`index.html` assembled from the parts in `controls/src/`; edit the words in `copy.json`, then run
`gen_sections.py` and `assemble.py` from that folder.

## Hosting

GitHub Pages serves this repo from `main` (Settings, Pages, Source: Deploy from a branch, `main`,
root). Pushing to `main` updates the site.
