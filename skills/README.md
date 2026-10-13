← [homelabdash](../README.md)

# Skills

Instructions for coding agents, in the [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) format. With Claude Code:

```
/plugin marketplace add xiaodoudou/homelabdash
/plugin install homelabdash@homelabdash
```

Other agents can read the `SKILL.md` files directly; [AGENTS.md](../AGENTS.md) points them here.

| Skill | Use it when you want to |
|---|---|
| [homelabdash-configure](homelabdash-configure/SKILL.md) | add services, tiles, sections or pages, wire secrets, change the layout, or move a gethomepage setup over |
| [homelabdash-create-plugin](homelabdash-create-plugin/SKILL.md) | write or fix a plugin for a service, with fixtures, examples and tests |
| [homelabdash-deploy](homelabdash-deploy/SKILL.md) | run, upgrade or expose the dashboard, or find out why a tile errors or stays stale |

The skills also tell the agent which checks to run before handing work back: `homelabdash validate`, `homelabdash plugin test`, and `npm run check` inside the repository.
