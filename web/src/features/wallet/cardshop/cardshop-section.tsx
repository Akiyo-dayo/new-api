import { AlertCircle, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { api, goodsPrice, goodsStockText, type Goods } from './api'
import { PurchaseDialog } from './cardshop-purchase-dialog'
import { SITE } from './config'

/** 从商品名中提取学分数量，如「星炬学院 10学分」→ 10 */
function creditAmount(g: Goods): string | null {
  const m = g.name.match(/(\d+(?:\.\d+)?)\s*学分/)
  return m ? m[1] : null
}

/**
 * 内嵌卡网商店：在 wallet 充值卡片中直接购买兑换码
 * 样式与官方预设金额按钮（preset amounts）保持一致
 */
export function CardShopSection() {
  const [goods, setGoods] = useState<Goods[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Goods | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const cats = (await api.categoryList()).filter((c) => c.id !== 0)
      const data = await api.goodsList(cats.length > 0 ? cats[0].id : 0)
      setGoods(data.list || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '商品加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className='space-y-2.5 border-t pt-4 sm:space-y-3 sm:pt-6'>
        <Skeleton className='h-3 w-24' />
        <div className='grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3'>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className='h-[72px] rounded-lg' />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='border-t pt-4 sm:pt-6'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription className='flex items-center justify-between gap-2'>
            <span>{error}</span>
            <Button variant='outline' size='sm' onClick={load}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (goods.length === 0) return null

  return (
    <div className='space-y-2.5 border-t pt-4 sm:space-y-3 sm:pt-6'>
      <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
        购买兑换码
      </Label>
      <div className='grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3'>
        {goods.map((g) => {
          const credit = creditAmount(g)
          const stock = goodsStockText(g)
          return (
            <Button
              key={g.goods_key}
              variant='outline'
              disabled={!stock.available}
              onClick={() => setSelected(g)}
              className={cn(
                'border-muted flex min-h-16 flex-col items-start rounded-lg px-3 py-2.5 text-left whitespace-normal sm:min-h-[72px] sm:p-4',
                'hover:border-foreground hover:bg-foreground/5 dark:hover:bg-foreground/10'
              )}
            >
              <div className='flex w-full items-center justify-between gap-1'>
                <div className='text-base font-semibold sm:text-lg'>
                  {credit ? `${credit} ${SITE.quotaUnit}` : g.name}
                </div>
                {stock.text && (
                  <div
                    className={cn(
                      'text-xs font-medium',
                      stock.available ? 'text-green-600' : 'text-muted-foreground'
                    )}
                  >
                    {stock.text}
                  </div>
                )}
              </div>
              <div className='text-muted-foreground mt-1.5 w-full text-xs sm:mt-2'>
                售价 ￥{goodsPrice(g)}
              </div>
            </Button>
          )
        })}
      </div>
      <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        <Zap className='h-3 w-3' />
        支付成功后自动发放兑换码，支持支付宝 / 微信，全程不离开本站
      </p>
      <PurchaseDialog goods={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
