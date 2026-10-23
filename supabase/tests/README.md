# supabase/tests —— 迁移和导入脚本的 PGlite 测试

在内存里的 Postgres 17（[PGlite](https://pglite.dev)）跑 `supabase/migrations/` 的全部迁移，再测函数和权限。不连网、不碰线上 Supabase；`auth` / `storage` 这些 Supabase 自带的东西用最小的假表代替（`helpers.mjs`）。**只用虚构数据**（「椰影岛」、`@example.com`、编出来的 uuid），这里是公开仓库。

| 文件 | 测什么 |
|---|---|
| `helpers.mjs` | 开一个内存库、按顺序跑迁移、以 `anon` / `authenticated` 身份跑 SQL、把时间戳换成占位符 |
| `platform-a.test.mjs` | 迁移 `20261022090000_platform_a`：老的 13 种桥接改动前后逐字一致（两个库跑同一批改动比结果和表）、分发器（`wx_op_ext` 认 `place.set` 补当地名字）、条目「怎么去」、档案写法和规则包一致、`create_trip_v2` / `set_trip_dates` / `set_trip_dest` / `add_household_to_trip` / `wx_bridge_trip_admin`、权限（陌生人、anon、只读成员）、重复执行 |
| `seed-trip.test.mjs` | `tools/seed-trip.mjs`：默认只新增（App 里改过的不被冲掉）、`--update` 时 `extra` 合并写、`extra.dest` 的写法检查 |

PGlite（`@electric-sql/pglite` 0.3.x）不是仓库的依赖，也不进 `npm test`。跑的时候告诉它在哪：

```bash
PGLITE_DIST=<…/node_modules/@electric-sql/pglite/dist> node --test supabase/tests/*.test.mjs
```

（本机装过 netlify CLI 的话，npx 缓存里就有一份：`~/.npm/_npx/<hash>/node_modules/netlify/node_modules/@electric-sql/pglite/dist`。）

以后加迁移：新文件名排在后面会被 `migrationFiles()` 自动带上；新的测试照 `platform-a.test.mjs` 写一个 `<迁移名>.test.mjs`。
