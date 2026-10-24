# 岗位库上线顺序

这次升级的数据库迁移是增量修改，旧版前后端仍能读取迁移后的 `job_postings`。不要在数据库迁移前部署新版导入脚本，因为新版飞书同步会写入新增字段。

1. 按顺序在 Supabase 执行：
   - `supabase/migrations/20261023110000_job_posting_canonical_sources.sql`
   - `supabase/migrations/20261023120000_company_job_source_registry.sql`
   - `supabase/migrations/20261023130000_retire_job_source_snapshots.sql`
   - `supabase/migrations/20261023140000_dedupe_ats_source_urls.sql`
   - `supabase/migrations/20261024100000_job_posting_published_at.sql`
2. 用新版代码手动运行一次飞书同步。它会把一行中的明确岗位列表拆成单岗位记录，并把旧聚合记录关闭；不会删除仍有其他有效来源的岗位。
3. 核对岗位数量、抽查重复项和投递链接。
4. 再推送并部署后端与前端。GitHub Actions 本身不会执行数据库迁移。
5. 企业官网同步器目前已接入华为、腾讯、百度、美团、小米、OPPO、联想和 NVIDIA 等官网；也支持
   飞书招聘、Moka、Hotjob、新旧 Zhiye、Eightfold PCSX，以及受域名、链接正则限制的
   schema.org `JobPosting` 页面。先用少量数据做只读检查：

   ```bash
   npm run jobs:sync-companies -- --dry-run --sample --limit 2
   ```

   本地确认后，可单独全量同步某个来源：

   ```bash
   npm run jobs:sync-companies -- --source huawei-campus
   npm run jobs:sync-companies -- --source tencent-careers
   npm run jobs:sync-companies -- --source oppo-experienced --source oppo-campus
   npm run jobs:sync-companies -- --source nvidia-china-all
   ```

   来源配置在 `config/company-job-sources.json`。GitHub Actions 每 12 小时执行一次完整快照同步：
   新岗位新增、已有岗位更新；官网快照中连续两次消失的来源才会失效，没有其他有效来源的岗位才会关闭。
   抓取不完整、任一分页/详情失败或岗位数量异常下降时，该企业不会执行下架。

   新企业若提供 schema.org `JobPosting`，使用 `jsonld-crawl` adapter，配置 `startUrls`、
   `allowedHosts` 和严格的 `followPattern`。该 adapter 检查 robots.txt，不登录、不处理验证码。
   动态 ATS 网站应新增独立 adapter，使用其公开招聘接口，不要把带登录鉴权的企业后台 API 放进同步器。
   PDD 官网虽然公开显示岗位，但列表接口当前要求反爬验证，不能绕过验证接入；在官网提供稳定公开接口前保持待接入。

   `npm run jobs:audit-priority` 用于检查 40 家重点公司的社招、校招、实习三类覆盖。当前静态配置与本地来源目录
   合计有 23 家三类齐全；联想已接校招/人才项目/实习，仍需补社会招聘。

   `npm run jobs:audit` 会扫描整张岗位主表、所有岗位来源和企业来源目录，检查过期开放岗位、空链接、
   非 HTTP 链接、旧 Hotjob 参数、没有有效来源的岗位，以及从未成功或长时间未同步的来源。部署流水线使用
   `npm run jobs:audit -- --strict`，关键完整性错误会让任务失败。`npm run jobs:expire` 可独立按北京时间删除
   已过截止日期的岗位，因此即使某个官网临时抓取失败，明确过期的岗位也不会继续展示。

6. 飞书岗位中的公告链接与投递链接可生成企业来源目录。先预览平台分布，再写入本地目录：

   ```bash
   npm run jobs:discover-companies -- --dry-run
   npm run jobs:discover-companies
   ```

   当前可自动同步 Moka 公开招聘页和新版 Hotjob wecruit 招聘页；旧版 Hotjob、前程无忧、
   智联和 Zhiye 会留在 `pending`，不会被通用爬虫盲目访问。抽查单个企业：

   ```bash
   npm run jobs:sync-discovered -- --platform moka --company 中能拾贝 --dry-run --sample
   npm run jobs:sync-discovered -- --platform hotjob --company '安利(中国)' --dry-run --sample
   ```

   Moka/Hotjob 使用公开求职页面调用的只读接口，不需要企业后台 API Key。每条岗位保存内容质量等级与
   0–100 的质量分，推荐系统应优先使用 `full` 且分数较高的岗位。公告/详情链接存入 `source_url`，
   投递入口存入 `apply_url`，前端不可互相回退。

   岗位列表优先按 `published_at` 排序；来源没有发布时间时，`sort_date` 自动回退到
   `source_updated_at`。页面展示时也会区分「发布」和「更新」。

   定时任务把静态官网来源与动态发现来源分开执行；静态官网每 12 小时同步一次。动态来源每 3 小时按
   `last_attempt_at` 从最久未检查的来源开始轮转，Moka 每批 150 个、Hotjob 每批 40 个、飞书招聘和 Zhiye
   每批各 100 个。平台任务最多两个并行，单个平台失败不会阻止其他平台完成。完整快照中新出现的岗位会新增，已有岗位会更新；岗位连续两次
   从同一来源的完整快照中消失后，该来源才会停用。只有当岗位没有任何其他有效来源时，主记录才会关闭。
   不完整快照、抓取中断或岗位数量异常下降都不会触发批量下架。

回滚代码时不需要回滚表结构；旧代码会忽略新增列。迁移和导入执行前后都应保留数据库备份或 PITR 恢复点。
