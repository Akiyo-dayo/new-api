// 鲸商城PRO（catfk）店铺开放接口客户端
// 全部接口逆向自卡网官方前端，浏览器直连（平台已开放 CORS）
import { SITE } from './config'
import { md5 } from './md5'

export interface ApiResp<T = unknown> {
  code: number
  msg: string
  data: T
}

export interface ShopInfo {
  nickname: string
  avatar: string
  description: string
  contact_qq?: string
  contact_wechat?: string
  contact_mobile?: string
  link_website?: string
  sell_count?: number
}

export interface Category {
  id: number
  name?: string
  title?: string
  category_name?: string
}

export interface Goods {
  goods_key: string
  name: string
  price?: number | string
  market_price?: number | string
  images?: string[] | string
  cover?: string
  image?: string
  stock?: number
  inventory?: number
  sales?: number
  sell_count?: number
  category?: { id: number; name?: string }
  extend?: {
    stock_count?: number
    show_stock_type?: number
    limit_count?: number
    query_password_status?: number
  }
}

export interface GoodsInfo extends Goods {
  description?: string
  contact_format?: unknown
  need_query_password?: number
  limit_count?: number
  user?: { token: string }
}

export interface Channel {
  id: number
  name?: string
  show_name?: string
  pay_name?: string
  channel_name?: string
  title?: string
  icon?: string
  paytype?: { name?: string; icon?: string }
}

export interface PriceInfo {
  original_amount?: number
  total_amount?: number
  sales_style?: unknown[]
}

export interface PayOrderResult {
  total_amount: number
  trade_no: string
  payurl?: string
}

export interface OrderItem {
  trade_no: string
  goods_name?: string
  name?: string
  total_amount?: number | string
  quantity?: number
  status?: number
  create_time?: number | string
  need_query_password?: number
  goods?: { goods_type?: string; name?: string }
  [k: string]: unknown
}

export interface CaptchaStart {
  img_url: string
  check_url: string
  ip: string
}

/** 把接口返回的卡网绝对地址改写为同源代理路径（验证码图片/校验地址都需走代理带 Cookie） */
export function proxify(url: string): string {
  if (url.startsWith(SITE.directApiBase)) return SITE.apiBase + url.slice(SITE.directApiBase.length)
  return url
}

async function post<T>(path: string, body: unknown): Promise<ApiResp<T>> {
  const url = path.startsWith('http')
    ? proxify(path)
    : path.startsWith(SITE.apiBase)
      ? path
      : SITE.apiBase + path
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('无法连接商店服务，请稍后重试')
  }
  if (!res.ok) throw new Error(`服务响应异常（HTTP ${res.status}），请稍后重试`)
  return (await res.json()) as ApiResp<T>
}

function unwrap<T>(resp: ApiResp<T>): T {
  if (resp.code !== 1) throw new Error(resp.msg || '操作失败，请稍后重试')
  return resp.data
}

export const api = {
  shopInfo: () =>
    post<ShopInfo>('/Shop/info', { token: SITE.shopToken }).then(unwrap),

  categoryList: () =>
    post<Category[]>('/Shop/categoryList', {
      token: SITE.shopToken,
      goods_type: 'card',
    }).then(unwrap),

  goodsList: (categoryId: number, page = 1) =>
    post<{ list: Goods[]; total?: number }>('/Shop/goodsList', {
      token: SITE.shopToken,
      keywords: '',
      category_id: categoryId,
      goods_type: 'card',
      current: page,
      pageSize: 50,
    }).then(unwrap),

  goodsInfo: (goodsKey: string) =>
    post<GoodsInfo>('/Shop/goodsInfo', { goods_key: goodsKey }).then(unwrap),

  userChannels: (shopUserToken: string) =>
    post<Channel[]>('/Shop/getUserChannel', { token: shopUserToken }).then(unwrap),

  goodsPrice: (p: { goods_key: string; quantity: number; coupon_code: string; channel_id: number }) =>
    post<PriceInfo>('/Shop/getGoodsPrice', p).then(unwrap),

  /** 下单：成功返回 { total_amount, trade_no, payurl } */
  payOrder: (p: {
    goods_key: string
    quantity: number
    coupon_code: string
    channel_id: number
    contact: string
  }) =>
    post<PayOrderResult>('/Pay/order', { ...p, extend: {} }).then((r) => {
      if (r.code === 0) throw new Error(r.msg || '下单失败')
      return r.data
    }),

  /** 轮询支付状态：code===1 表示已支付 */
  payQuery: (tradeNo: string) => post<unknown>('/Pay/query', { trade_no: tradeNo }),

  captchaStart: () =>
    post<CaptchaStart>('/Common/captchaStart', {})
      .then(unwrap)
      .then((cap) => ({ ...cap, img_url: proxify(cap.img_url), check_url: proxify(cap.check_url) })),

  /** 校验图形验证码，签名算法与官方前端一致 */
  captchaCheck: (cap: CaptchaStart, code: string) => {
    const sign = md5(md5(code + cap.ip) + 'JING')
    return post<{ ticket: string }>(cap.check_url, { code, sign }).then(unwrap)
  },

  orderList: (keywords: string, ticket: string, page = 1) =>
    post<{ list: OrderItem[]; total?: number }>('/Order/list', {
      keywords,
      ticket,
      current: page,
      pageSize: 20,
    }).then(unwrap),

  orderInfo: (tradeNo: string, queryPassword?: string) =>
    post<Record<string, unknown>>('/Order/info', {
      trade_no: tradeNo,
      query_password: queryPassword,
      dump: 1,
    }).then(unwrap),
}

// ---------- 工具函数 ----------

export function goodsImage(g: Goods): string | undefined {
  if (Array.isArray(g.images) && g.images.length > 0) return g.images[0]
  if (typeof g.images === 'string' && g.images) return g.images
  return g.cover || g.image || undefined
}

export function goodsPrice(g: Goods): string {
  const p = g.price ?? g.market_price
  if (p === undefined || p === null || p === '') return '—'
  const n = Number(p)
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, '') : String(p)
}

export function goodsStock(g: Goods): number | undefined {
  const s = g.stock ?? g.inventory ?? g.extend?.stock_count
  return typeof s === 'number' ? s : undefined
}

/** 库存展示：与官方店铺一致，充足时显示"库存充足" */
export function goodsStockText(g: Goods): { text: string; available: boolean } {
  const s = goodsStock(g)
  if (s === undefined) return { text: '', available: true }
  if (s <= 0) return { text: '缺货', available: false }
  if (s >= 10) return { text: '库存充足', available: true }
  return { text: `仅剩 ${s} 件`, available: true }
}

export function channelName(c: Channel): string {
  return c.show_name || c.name || c.pay_name || c.channel_name || c.title || `支付渠道 ${c.id}`
}

export function channelIcon(c: Channel): string | undefined {
  return c.paytype?.icon || c.icon
}

/** 从订单详情中提取卡密列表：官方路径为 data.response.cards（字符串数组），其余候选键做防御式兜底 */
export function extractCards(data: Record<string, unknown>): string[] {
  // 官方卡网订单详情：卡密在 response.cards，导出链接在 response.export_cards_url
  const resp = data.response as Record<string, unknown> | undefined
  if (resp && Array.isArray(resp.cards)) {
    const out = resp.cards
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter((c) => c.length > 0)
    if (out.length > 0) return out
  }
  const CANDIDATE_KEYS = ['cards', 'card', 'carmi', 'carmis', 'kami', 'card_list', 'secrets', 'card_info', 'order_cards']
  const out: string[] = []
  const pushVal = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim())
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['card', 'carmi', 'secret', 'code', 'password', 'content', 'card_no']) {
        if (typeof o[k] === 'string' && (o[k] as string).trim()) {
          out.push((o[k] as string).trim())
          return
        }
      }
    }
  }
  for (const key of CANDIDATE_KEYS) {
    const v = data[key]
    if (Array.isArray(v)) v.forEach(pushVal)
    else if (v) pushVal(v)
    if (out.length > 0) return out
  }
  // 兜底：扫描一层嵌套
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'object' || typeof x === 'string')) {
      const before = out.length
      v.forEach(pushVal)
      if (out.length > before) return out
    }
  }
  return out
}

export function orderStatusBadge(status?: number): { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  switch (status) {
    case 1:
      return { text: '已完成', variant: 'default' }
    case 0:
      return { text: '待支付', variant: 'secondary' }
    case 2:
      return { text: '已取消', variant: 'outline' }
    default:
      return { text: status === undefined ? '未知' : `状态 ${status}`, variant: 'outline' }
  }
}

export function formatTime(t?: number | string): string {
  if (!t) return ''
  const n = Number(t)
  const d = Number.isFinite(n) && n > 1e9 ? new Date(n * 1000) : new Date(String(t))
  if (Number.isNaN(d.getTime())) return String(t)
  return d.toLocaleString('zh-CN', { hour12: false })
}

// ---------- 联系方式格式（对应官方 contact_format） ----------

export interface ContactMeta {
  label: string
  placeholder: string
  validate: (v: string) => string | null
}

export function contactMeta(contactFormat: unknown): ContactMeta {
  let t = ''
  if (typeof contactFormat === 'string') t = contactFormat
  else if (contactFormat && typeof contactFormat === 'object') {
    const o = contactFormat as Record<string, unknown>
    t = String(o.type ?? o.format ?? o.field ?? '')
  }
  t = t.toLowerCase()

  if (t.includes('email') || t.includes('mail')) {
    return {
      label: '邮箱',
      placeholder: '请输入邮箱（用于接收/查询卡密）',
      validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : '请输入正确的邮箱地址'),
    }
  }
  if (t.includes('mobile') || t.includes('phone')) {
    return {
      label: '手机号',
      placeholder: '请输入手机号（用于查询订单）',
      validate: (v) => (/^1[3-9]\d{9}$/.test(v) ? null : '请输入正确的手机号'),
    }
  }
  if (t.includes('qq')) {
    return {
      label: 'QQ 号',
      placeholder: '请输入 QQ 号（用于查询订单）',
      validate: (v) => (/^[1-9]\d{4,10}$/.test(v) ? null : '请输入正确的 QQ 号'),
    }
  }
  return {
    label: '联系方式',
    placeholder: '请输入邮箱 / QQ 等（用于查询订单与接收卡密）',
    validate: (v) => (v.trim().length >= 5 ? null : '请输入有效的联系方式（至少 5 个字符）'),
  }
}
