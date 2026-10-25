# 支付宝自动到账通知方案调研

研究日期：2026-10-25。当前使用作者提供的支付宝静态收款码，站点支持登记、人工核实流水、唯一流水入账、累计榜和动态。它不具备官方订单下单 / 通知配置，不能从图片自行推导官方回调。

| 路线 | 开源项目 | 适配与判断 |
|---|---|---|
| 官方接口 | [alipay/alipay-sdk-nodejs-all](https://github.com/alipay/alipay-sdk-nodejs-all) | 首选；与本站 Node 24 匹配。官方 SDK 提供 RSA2 通知验签。需要自己的开放平台应用和已开通的支付产品权限，以及正确的应用 / 支付宝证书或公钥配置。 |
| 完整支付平台 | [jeequan/jeepay](https://github.com/jeequan/jeepay) | 已对接支付宝、微信等官方通道；适合多渠道、多商户及独立支付后台。本站单个支持入口用它会增加部署和运维，本阶段不需要。 |
| PHP SDK | [yansongda/pay](https://github.com/yansongda/pay) | 提供回调验签等封装；已有 PHP 服务可考虑。本站是 Node，无需为此另加 PHP。 |
| 个人通知监听 | [szvone/vmqphp](https://github.com/szvone/vmqphp)、[Vmq](https://github.com/szvone/Vmq) | 依赖安卓手机 / 模拟器上的监控端监听收款消息，再向服务端回调。作者明确提示商业使用申请官方商户接口。 |

V免签的设备消息不是支付宝服务端对该笔订单的官方签名通知。由此推断，其可信程度、完整性和在线状态依赖监听端；通知丢失、重复、同额匹配或消息格式变化需要处理。若未来试验，应独立部署，只作为辅助待核对信号，并保留手工确认入口。本轮没有审计或安装其全部代码，也不采信 README 中“无后门”等自我保证。

推荐的正式链路：站点建立用户关联订单 → 支付宝官方订单接口返回该笔订单的支付入口 → 收到 notify_url 通知 → SDK 验签 → 核对 app_id、收款主体、订单号、币种 / 金额及交易成功状态 → 事务性且幂等地更新站内支持记录 → 更新累计榜与动态。仅浏览器跳转、付款截图或客户端上报不能作为自动入账依据。

需补齐重试、重复通知、乱序通知、退款、主动查询补单和对账；不要收到任何成功字段就直接计入。商户准入与产品权限须以实际支付宝账户可开通的产品和当前官方要求为准，不假设个人码、企业号或域名本身已具备权限。没有替用户开户、签约、修改计费或执行付款。

资料：[官方 SDK 通知验签](https://github.com/alipay/alipay-sdk-nodejs-all#通知验签)、[Jeepay 通道接入](https://docs.jeequan.com/docs/jeepay/dev_channel)、[yansongda 回调](https://pay.yansongda.cn/docs/v3/alipay/v3/callback)、[V免签部署说明](https://github.com/szvone/Vmq#安装)。
