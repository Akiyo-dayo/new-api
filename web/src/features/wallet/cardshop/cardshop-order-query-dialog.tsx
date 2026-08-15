import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Copy, Loader2, PackageSearch, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  extractCards,
  formatTime,
  orderStatusBadge,
  type CaptchaStart,
  type OrderItem,
} from './api'

type Step = 'form' | 'captcha' | 'list' | 'detail'

const labelCls = 'text-muted-foreground text-xs font-medium tracking-wider uppercase'

export function OrderQueryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<Step>('form')
  const [keywords, setKeywords] = useState('')
  const [error, setError] = useState('')

  // captcha
  const [cap, setCap] = useState<CaptchaStart | null>(null)
  const [capCode, setCapCode] = useState('')
  const [capLoading, setCapLoading] = useState(false)
  const capInputRef = useRef<HTMLInputElement>(null)

  // results
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(false)

  // detail
  const [current, setCurrent] = useState<OrderItem | null>(null)
  const [needPassword, setNeedPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [cards, setCards] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setStep('form')
      setError('')
      setOrders([])
      setCurrent(null)
      setDetail(null)
      setCards([])
      setPassword('')
    }
  }, [open])

  const loadCaptcha = async () => {
    setCapLoading(true)
    setError('')
    setCapCode('')
    try {
      const data = await api.captchaStart()
      // 防缓存时间戳必须在加载时固定一次；若放在渲染里，每次输入都会生成新 src 导致图片反复刷新
      setCap({ ...data, img_url: `${data.img_url}&t=${Date.now()}` })
      setTimeout(() => capInputRef.current?.focus(), 50)
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证码加载失败')
    } finally {
      setCapLoading(false)
    }
  }

  const startQuery = () => {
    if (keywords.trim().length < 3) {
      setError('请输入下单时填写的联系方式（邮箱 / QQ / 手机号）')
      return
    }
    setError('')
    setStep('captcha')
    loadCaptcha()
  }

  const submitCaptcha = async () => {
    if (!cap) return
    if (!capCode.trim()) {
      setError('请输入图中验证码')
      return
    }
    setCapLoading(true)
    setError('')
    try {
      const { ticket } = await api.captchaCheck(cap, capCode.trim())
      setLoading(true)
      setStep('list')
      try {
        const data = await api.orderList(keywords.trim(), ticket)
        setOrders(data.list || [])
      } catch (e) {
        setError(e instanceof Error ? e.message : '查询失败，请重试')
        setStep('form')
      } finally {
        setLoading(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证失败，请重试')
      loadCaptcha()
    } finally {
      setCapLoading(false)
    }
  }

  const openDetail = async (o: OrderItem, pwd?: string) => {
    setCurrent(o)
    setStep('detail')
    setLoading(true)
    setError('')
    if (pwd === undefined) {
      setDetail(null)
      setCards([])
    }
    try {
      const data = await api.orderInfo(o.trade_no, pwd)
      setDetail(data)
      setCards(extractCards(data))
    } catch (e) {
      setError(e instanceof Error ? e.message : '订单详情加载失败')
    } finally {
      setLoading(false)
    }
  }

  const clickOrder = (o: OrderItem) => {
    const need = o.need_query_password === 1 && o.goods?.goods_type === 'card'
    setNeedPassword(!!need)
    setPassword('')
    if (need) {
      setCurrent(o)
      setStep('detail')
      setDetail(null)
      setCards([])
      setError('')
    } else {
      openDetail(o)
    }
  }

  const detailStatus = (detail?.status as number | undefined) ?? current?.status

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>卡密订单查询</DialogTitle>
          <DialogDescription>通过下单时填写的联系方式查询订单与卡密</DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className={labelCls}>联系方式</Label>
              <div className="flex gap-2">
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="邮箱 / QQ / 手机号"
                  className="h-9"
                  onKeyDown={(e) => e.key === 'Enter' && startQuery()}
                />
                <Button className="h-9 shrink-0 gap-2" onClick={startQuery}>
                  <Search className="h-4 w-4" />
                  查询
                </Button>
              </div>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        {step === 'captcha' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className={labelCls}>安全验证</Label>
              <div className="flex items-center gap-3">
                {capLoading || !cap ? (
                  <Skeleton className="h-16 w-40 rounded-md" />
                ) : (
                  <img
                    src={cap.img_url}
                    alt="验证码"
                    className="bg-muted h-16 w-40 rounded-md border object-cover"
                  />
                )}
                <Button variant="outline" size="icon" onClick={loadCaptcha} disabled={capLoading} title="换一张">
                  <RefreshCw className={capLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                </Button>
              </div>
              <Input
                ref={capInputRef}
                value={capCode}
                onChange={(e) => setCapCode(e.target.value)}
                placeholder="请输入图中字符"
                className="h-9"
                maxLength={8}
                onKeyDown={(e) => e.key === 'Enter' && submitCaptcha()}
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('form')}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                返回
              </Button>
              <Button className="flex-1" onClick={submitCaptcha} disabled={capLoading || !cap}>
                {capLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                确认查询
              </Button>
            </div>
          </div>
        )}

        {step === 'list' && (
          <div className="space-y-3">
            {loading ? (
              [0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <PackageSearch className="h-8 w-8" />
                <p className="text-sm">未查询到相关订单，请确认联系方式是否正确</p>
                <Button variant="outline" size="sm" onClick={() => setStep('form')}>
                  重新查询
                </Button>
              </div>
            ) : (
              <>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {orders.map((o) => {
                    const badge = orderStatusBadge(o.status)
                    const title = o.goods_name || o.goods?.name || o.name || '卡密商品'
                    return (
                      <button
                        key={o.trade_no}
                        onClick={() => clickOrder(o)}
                        className="hover:ring-foreground/20 block w-full rounded-lg border p-3 text-left transition-all hover:bg-muted/40 hover:ring-1 focus:outline-none"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{title}</p>
                            <p className="text-muted-foreground mt-0.5 font-mono text-xs">{o.trade_no}</p>
                            {o.create_time && (
                              <p className="text-muted-foreground mt-0.5 text-xs">{formatTime(o.create_time)}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge variant={badge.variant}>{badge.text}</Badge>
                            {o.total_amount !== undefined && (
                              <span className="text-sm font-semibold tabular-nums">￥{o.total_amount}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <Button variant="outline" className="w-full" onClick={() => setStep('form')}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  换个联系方式查询
                </Button>
              </>
            )}
          </div>
        )}

        {step === 'detail' && current && (
          <div className="space-y-3">
            <div className="bg-muted/40 flex items-center justify-between rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{current.goods_name || current.goods?.name || '卡密商品'}</p>
                <p className="text-muted-foreground font-mono text-xs">{current.trade_no}</p>
              </div>
              <Badge variant={orderStatusBadge(detailStatus).variant}>{orderStatusBadge(detailStatus).text}</Badge>
            </div>

            {needPassword && !detail ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className={labelCls}>安全密码</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="该商品开启了查询密码，请输入"
                    className="h-9"
                    onKeyDown={(e) => e.key === 'Enter' && password && openDetail(current, password)}
                  />
                </div>
                {error && <p className="text-destructive text-sm">{error}</p>}
                <Button className="w-full" disabled={!password || loading} onClick={() => openDetail(current, password)}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  查看卡密
                </Button>
              </div>
            ) : loading ? (
              <Skeleton className="h-28 rounded-lg" />
            ) : (
              <>
                {error && <p className="text-destructive text-sm">{error}</p>}
                {detailStatus !== 1 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    订单尚未支付完成，完成支付后卡密将在此显示。
                  </p>
                ) : cards.length > 0 ? (
                  <div className="space-y-2">
                    <Label className={labelCls}>卡密</Label>
                    {cards.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border p-3">
                        <code className="flex-1 select-all break-all font-mono text-sm">{c}</code>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(c)
                            toast.success('卡密已复制')
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  !error && (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      未能从订单中解析到卡密，请联系店主处理。
                    </p>
                  )
                )}
              </>
            )}

            <Button variant="outline" className="w-full" onClick={() => setStep('list')}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              返回订单列表
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
