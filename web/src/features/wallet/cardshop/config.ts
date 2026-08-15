// 卡网店铺配置 —— 部署时只需改这里
export const SITE = {
  // 卡网 API 同源代理前缀（/fk-api/* → https://catfk.com/shopApi/*）
  // 开发环境由 rsbuild dev proxy 转发；生产环境由 Caddy 反代（见部署说明）。
  // 验证码图片依赖 PHP 会话 Cookie，必须走同源代理才能正常显示。
  apiBase: '/fk-api',
  // 卡网 API 直连地址（仅用于把接口返回的绝对地址改写回代理前缀）
  directApiBase: 'https://catfk.com/shopApi',
  // 你的店铺 token（店铺链接 https://catfk.com/shop/<token>）
  shopToken: 'ZULO4R51',
  // 品牌信息（与 new-api 中转站保持一致）
  brandName: '星炬学院',
  // 额度单位名称（new-api 后台可自定义，此处为「学分」）
  quotaUnit: '学分',
  // 中转站地址
  consoleUrl: 'https://newapi.akiyo.fun/',
} as const

