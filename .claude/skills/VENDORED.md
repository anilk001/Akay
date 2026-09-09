# Vendored third-party skills

These skills are vendored from open-source repos, with each one's LICENSE file
included alongside it. To update one, re-copy its SKILL.md from the source repo
(task-observer also ships `references/` and `scripts/` — re-copy those too).

| Skill | Source | Licence |
|---|---|---|
| emil-design-eng | https://github.com/emilkowalski/skills | MIT |
| web-design-guidelines | https://github.com/vercel-labs/agent-skills | MIT |
| brandkit | https://github.com/leonxlnx/taste-skill | MIT |
| image-to-code | https://github.com/leonxlnx/taste-skill (skills/image-to-code-skill) | MIT |
| extract-design-system | https://github.com/arvindrk/extract-design-system | MIT |
| task-observer | https://github.com/rebelytics/one-skill-to-rule-them-all | CC BY 4.0 |

task-observer is the odd one out in two ways. Its licence is CC BY 4.0, not MIT,
so adaptations must keep crediting Eoghan Henn / rebelytics.com — the attribution
block at the top of its SKILL.md is that credit, so leave it in place. And it is
the only vendored skill that keeps state: `.claude/task-observer/` holds its
observation log and staging area. See `.claude/task-observer/README.md` for why
that lives in the repo and for the activation tier still missing.

UI/UX Pro Max is not vendored — it is installed as a plugin via
`.claude/settings.json` (`ui-ux-pro-max@ui-ux-pro-max-skill`).
