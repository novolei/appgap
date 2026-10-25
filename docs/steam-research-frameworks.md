# Steam 社区方法与开源方案核对

核对日期：2026-10-25。星标只作社区采用线索，不是质量评分；维护时间为 GitHub API 返回的 pushed_at。只借鉴方法，不引入整套采集依赖、不使用发行商私有权限。

| 项目 / 研究 | 现场状态 | 采用的部分 | 不直接采用的部分 |
| --- | --- | --- | --- |
| [FronkonGames/Steam-Games-Scraper](https://github.com/FronkonGames/Steam-Games-Scraper) | MIT，166 星，最后推送 2026-06-19，未归档 | 游戏与 DLC / 软件分离、增量缓存、保存原始 JSON、统一币种参考 | 全应用目录接口需要 Steam API Key；本轮没有该授权。SteamSpy 的 owners 区间是模型估计，不能当销量；旧样本数据不能替代当天地区榜 |
| [SteamTracking/Protobufs](https://github.com/SteamTracking/Protobufs) | Unlicense，586 星，最后推送 2026-10-23 | 跟踪协议字段变化，为公开商店接口做结构检查 | 这是协议档案，不是市场分析框架；不调用其中的私人 / 高权限接口，文档化评论 API 优先 |
| [woctezuma/download-steam-reviews](https://github.com/woctezuma/download-steam-reviews) | MIT，102 星，最后推送 2026-02-26 | 评论 recommendationid 去重、分页 / 缓存、将获取来源与评价分开 | 旧 appreviews 路径已废弃，不能直接沿用。评论与销量的倍率随年份、免费获取、语言与品类变化，不采用固定倍率 |
| [prncc/steam-scraper](https://github.com/prncc/steam-scraper) | 已归档，93 星，最后推送 2018-02-11 | 商店、评论、原始响应分层，可恢复任务的组织方式 | 陈旧端点和年龄验证自动化不适用；不是当前可运行的生产采集方案 |
| [oguzhanozfe/steam-discovery](https://github.com/oguzhanozfe/steam-discovery) | 0 星，最后推送 2026-10-22 | 研究论点、原始来源、开发者行动计划分开存放的编排思路 | 项目很新，不能称为成熟或著名框架；它的二手结论不直接成为本项目数据事实 |

[From Fads to Classics](https://arxiv.org/abs/2506.08881) 使用标签的时间演化研究趋势；[Games Mapper](https://arxiv.org/abs/2606.14376) 则研究子类型关系与跨年演化。这里采用的启发是：保留标签组合和日期，区分长期类型、短时热潮与具体机制，而不是只看 Action / RPG 等大类。两篇论文的结论不能替代当前数据，本轮不复现其全量历史模型，也不把单日榜单输入聚类后声称预测未来。

本项目的取舍：先以官方区域榜、当前商店资料、时间受限的评论组成可审计小样本；用 n/N、类型标签组合、相对全球上榜指数、折扣 / 发行阶段对照与可追溯原评形成假设。再用每日历史观察持续性，用原型实验检验迁移意愿。未来若加入全量新发行目录，应明确新的 API 权限、更新成本和失败游戏的对照样本，再研究竞争密度、同价位成功分布与发行窗口。

当前无法从公开榜单得到各国收入金额、付费人数、愿望单或某类型的完整供给量。因此不计算 TAM、真实市场份额、回本概率或“未来三个月必涨”的预测。人工审查关键词命中、反例、折扣影响和团队成本，仍是立项前的必要步骤。
