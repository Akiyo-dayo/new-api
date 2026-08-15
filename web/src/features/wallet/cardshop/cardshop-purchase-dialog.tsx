import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Minus, Plus, Copy, Check, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  contactMeta,
  extractCards,
  channelName,
  channelIcon,
  type Channel,
  type Goods,
  type GoodsInfo,
  type PriceInfo,
} from './api'
import { SITE } from './config'

type PayStage = 'form' | 'paying' | 'done'

export function PurchaseDialog({ goods, onClose }: { goods: Goods | null; onClose: () => void }) {
  const [info, setInfo] = useState<GoodsInfo | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelId, setChannelId] = useState<number>(0)
  const [quantity, setQuantity] = useState(1)
  const [contact, setContact] = useState('')
  const [coupon, setCoupon] = useState('')
  const [price, setPrice] = useState<PriceInfo | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [stage, setStage] = useState<PayStage>('form')
  const [tradeNo, setTradeNo] = useState('')
  const [payurl, setPayurl] = useState('')
  const [cards, setCards] = useState<string[]>([])
  const [formError, setFormError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    if (!goods) return
    setInfo(null)
    setChannels([])
    setChannelId(0)
    setQuantity(1)
    setContact('')
    setCoupon('')
    setPrice(null)
    setStage('form')
    setFormError('')
    setCards([])
    stopPoll()
    ;(async () => {
      try {
        const gi = await api.goodsInfo(goods.goods_key)
        setInfo(gi)
        const userToken = gi.user?.token
        if (userToken) {
          const chs = await api.userChannels(userToken)
          setChannels(chs)
          if (chs.length > 0) setChannelId(chs[0].id)
        }
      } catch (e) {
        setFormError(e instanceof Error ? e.message : '商品详情加载失败')
      }
    })()
    return stopPoll
  }, [goods])

  // 实时价格（数量 / 优惠码 / 渠道变化时重新计算）
  useEffect(() => {
    if (!goods || !info || stage !== 'form') return
    const timer = setTimeout(async () => {
      setPriceLoading(true)
      try {
        const p = await api.goodsPrice({
          goods_key: goods.goods_key,
          quantity,
          coupon_code: coupon.trim(),
          channel_id: channelId,
        })
        setPrice(p)
      } catch {
        setPrice(null)
      } finally {
        setPriceLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [goods, info, quantity, coupon, channelId, stage])

  const meta = contactMeta(info?.contact_format)

  const fetchCards = useCallback(async (tn: string) => {
    try {
      const detail = await api.orderInfo(tn)
      setCards(extractCards(detail))
    } catch {
      setCards([])
    }
  }, [])

  const startPoll = useCallback(
    (tn: string) => {
      stopPoll()
      pollRef.current = setInterval(async () => {
        try {
          const r = await api.payQuery(tn)
          if (r.code === 1) {
            stopPoll()
            await fetchCards(tn)
            setStage('done')
          }
        } catch {
          /* 网络抖动时继续轮询 */
        }
      }, 3000)
    },
    [fetchCards],
  )

  const submit = async () => {
    if (!goods || !info) return
    const err = meta.validate(contact.trim())
    if (err) {
      setFormError(err)
      return
    }
    if (!channelId && channels.length > 0) {
      setFormError('请选择支付方式')
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      const result = await api.payOrder({
        goods_key: goods.goods_key,
        quantity,
        coupon_code: coupon.trim(),
        channel_id: channelId,
        contact: contact.trim(),
      })
      setTradeNo(result.trade_no)
      if (result.total_amount === 0) {
        await fetchCards(result.trade_no)
        setStage('done')
        return
      }
      if (result.payurl) {
        setPayurl(result.payurl)
        window.open(result.payurl, '_blank', 'noopener')
      }
      setStage('paying')
      startPoll(result.trade_no)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '下单失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const labelCls = 'text-muted-foreground text-xs font-medium tracking-wider uppercase'

  return (
    <Dialog open={!!goods} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {stage === 'form' && (
          <>
            <DialogHeader>
              <DialogTitle>{goods?.name}</DialogTitle>
              <DialogDescription>填写信息后立即下单，卡密将在支付完成后自动展示</DialogDescription>
            </DialogHeader>
            {!info && !formError ? (
              <div className="space-y-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <div className="space-y-4 sm:space-y-5">
                <div className="space-y-2">
                  <Label className={labelCls}>{meta.label}</Label>
                  <Input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder={meta.placeholder}
                    className="h-9"
                  />
                  <p className="text-muted-foreground text-xs">用于支付完成后查询订单与找回卡密，请牢记</p>
                </div>

                <div className="space-y-2">
                  <Label className={labelCls}>购买数量</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-10 text-center font-mono font-medium tabular-nums">{quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className={labelCls}>优惠码（选填）</Label>
                  <Input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="有优惠码可填写" className="h-9" />
                </div>

                {channels.length > 0 && (
                  <div className="space-y-2">
                    <Label className={labelCls}>支付方式</Label>
                    <div className="grid grid-cols-2 gap-1.5 sm:gap-3">
                      {channels.map((c) => {
                        const icon = channelIcon(c)
                        const active = channelId === c.id
                        return (
                          <Button
                            key={c.id}
                            variant="outline"
                            onClick={() => setChannelId(c.id)}
                            className={`min-h-12 justify-start gap-2 rounded-lg px-3 ${
                              active ? 'border-foreground bg-foreground/5 dark:bg-foreground/10' : 'border-muted'
                            }`}
                          >
                            {icon && <img src={icon} alt="" className="h-4 w-4 rounded-sm object-contain" />}
                            <span className="max-w-full truncate">{channelName(c)}</span>
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">应付金额</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {priceLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : price?.total_amount !== undefined ? (
                      `￥${Number(price.total_amount).toFixed(2)}`
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
                {formError && <p className="text-destructive text-sm">{formError}</p>}
                <Button className="w-full" onClick={submit} disabled={submitting || !info}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  立即支付
                </Button>
              </div>
            )}
          </>
        )}

        {stage === 'paying' && (
          <>
            <DialogHeader>
              <DialogTitle>等待支付</DialogTitle>
              <DialogDescription>支付页面已在新窗口打开，完成支付后此页将自动更新</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-muted/50 flex items-center gap-3 rounded-lg border p-4">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-green-600" />
                <div className="text-sm">
                  <p className="font-medium">正在等待支付结果…</p>
                  <p className="text-muted-foreground font-mono text-xs">订单号：{tradeNo}</p>
                </div>
              </div>
              {payurl && (
                <Button variant="outline" className="w-full gap-2" onClick={() => window.open(payurl, '_blank', 'noopener')}>
                  <ExternalLink className="h-4 w-4" />
                  支付页面未打开？点击重新打开
                </Button>
              )}
              <Button variant="ghost" className="w-full" onClick={onClose}>
                稍后再说（可在「卡密订单查询」中找回）
              </Button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/10">
                  <Check className="h-4 w-4 text-green-600" />
                </span>
                支付成功
              </DialogTitle>
              <DialogDescription>
                复制卡密后，在本页「兑换码」输入框中兑换即可充值{SITE.quotaUnit}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="bg-muted/40 rounded-lg border p-3 text-sm">
                <p className="text-muted-foreground text-xs">订单号</p>
                <p className="font-mono">{tradeNo}</p>
              </div>
              {cards.length > 0 ? (
                <div className="space-y-2">
                  <Label className={labelCls}>您的卡密（请妥善保存）</Label>
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
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  卡密稍后可在「卡密订单查询」中通过{meta.label}找回。
                </p>
              )}
              <Button className="w-full" onClick={onClose}>
                完成
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
