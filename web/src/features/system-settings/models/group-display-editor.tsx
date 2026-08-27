/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation } from '@tanstack/react-query'
import { GripVertical } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { updateSystemOption } from '../api'
import { safeJsonParse } from '../utils/json-parser'

// ---------------------------------------------------------------------------
// Types — mirror `setting.GroupDisplaySetting` one-to-one.
// ---------------------------------------------------------------------------

type GroupDisplayItem = {
  group: string
  category?: string
  /** Undefined means "decide from the ratio" (a zero-ratio group is hidden). */
  hidden_by_default?: boolean
}

type GroupDisplayCategory = {
  name: string
  default_expanded: boolean
}

type GroupDisplayConfig = {
  groups: GroupDisplayItem[]
  categories: GroupDisplayCategory[]
}

/** Tri-state for the visibility column; `auto` means no explicit override. */
const VISIBILITY = {
  AUTO: 'auto',
  HIDDEN: 'hidden',
  SHOWN: 'shown',
} as const

type Visibility = (typeof VISIBILITY)[keyof typeof VISIBILITY]

function visibilityOf(item: GroupDisplayItem): Visibility {
  if (item.hidden_by_default === undefined) return VISIBILITY.AUTO
  return item.hidden_by_default ? VISIBILITY.HIDDEN : VISIBILITY.SHOWN
}

type GroupDisplayEditorProps = {
  /** Raw `GroupDisplayConfig` option value. */
  value: string | undefined
  /** Raw `GroupRatio` option value, used to list every configurable group. */
  groupRatio: string | undefined
}

/**
 * Merge the saved order with the groups that actually exist right now.
 *
 * Saved-but-deleted groups are dropped and newly created groups are appended, so
 * the editor always reflects the live group list without the admin having to
 * re-add anything by hand.
 */
function mergeRows(
  saved: GroupDisplayItem[],
  ratios: Record<string, number>
): GroupDisplayItem[] {
  const live = new Set(Object.keys(ratios))
  const rows = saved.filter((item) => live.has(item.group))
  const seen = new Set(rows.map((item) => item.group))
  for (const group of Object.keys(ratios).sort()) {
    if (!seen.has(group)) rows.push({ group })
  }
  return rows
}

export function GroupDisplayEditor(props: GroupDisplayEditorProps) {
  const { t } = useTranslation()

  const ratios = useMemo(
    () =>
      safeJsonParse<Record<string, number>>(props.groupRatio, {
        fallback: {},
        silent: true,
      }),
    [props.groupRatio]
  )
  const saved = useMemo(
    () =>
      safeJsonParse<GroupDisplayConfig>(props.value, {
        fallback: { groups: [], categories: [] },
        silent: true,
      }),
    [props.value]
  )

  const [rows, setRows] = useState<GroupDisplayItem[]>(() =>
    mergeRows(saved.groups ?? [], ratios)
  )
  const [categories, setCategories] = useState<GroupDisplayCategory[]>(
    () => saved.categories ?? []
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragCategory, setDragCategory] = useState<number | null>(null)

  // Categories only exist because some row names one, so the list is derived
  // from the rows; the saved entries contribute the expand flag and the order.
  const usedCategories = useMemo(() => {
    const names: string[] = []
    for (const row of rows) {
      const name = row.category?.trim()
      if (name && !names.includes(name)) names.push(name)
    }
    const ordered = categories
      .filter((c) => names.includes(c.name))
      .map((c) => ({ ...c }))
    for (const name of names) {
      if (!ordered.some((c) => c.name === name)) {
        ordered.push({ name, default_expanded: false })
      }
    }
    return ordered
  }, [rows, categories])

  const moveRow = useCallback((from: number, to: number) => {
    setRows((prev) => {
      if (from === to || from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const moveCategory = useCallback(
    (from: number, to: number) => {
      const ordered = usedCategories
      if (from === to || from < 0 || to < 0 || to >= ordered.length) return
      const next = [...ordered]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      setCategories(next)
    },
    [usedCategories]
  )

  const updateRow = useCallback(
    (index: number, patch: Partial<GroupDisplayItem>) => {
      setRows((prev) =>
        prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
      )
    },
    []
  )

  const setVisibility = useCallback((index: number, visibility: Visibility) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row
        const next = { ...row }
        if (visibility === VISIBILITY.AUTO) {
          delete next.hidden_by_default
          return next
        }
        next.hidden_by_default = visibility === VISIBILITY.HIDDEN
        return next
      })
    )
  }, [])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: GroupDisplayConfig = {
        // Rows that carry no setting at all still matter: their position is the
        // display order, so they are saved rather than pruned.
        groups: rows.map((row) => {
          const item: GroupDisplayItem = { group: row.group }
          const category = row.category?.trim()
          if (category) item.category = category
          if (row.hidden_by_default !== undefined) {
            item.hidden_by_default = row.hidden_by_default
          }
          return item
        }),
        categories: usedCategories,
      }
      await updateSystemOption({
        key: 'GroupDisplayConfig',
        value: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      setCategories(usedCategories)
      toast.success(t('Saved'))
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Save failed'))
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Model Square Display')}</CardTitle>
        <CardDescription>
          {t(
            'Drag to set the order groups appear in on the model square. Groups sharing a category collapse together; a category left collapsed keeps its groups out of the way without hiding them.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <div className='space-y-2'>
          <div className='text-muted-foreground grid grid-cols-[2rem_minmax(0,1.4fr)_5rem_minmax(0,1fr)_9rem] items-center gap-2 px-1 text-xs font-medium'>
            <span />
            <span>{t('Group')}</span>
            <span>{t('Ratio')}</span>
            <span>{t('Category')}</span>
            <span>{t('Visibility')}</span>
          </div>
          {rows.map((row, index) => (
            <div
              key={row.group}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) moveRow(dragIndex, index)
                setDragIndex(null)
              }}
              onDragEnd={() => setDragIndex(null)}
              className={cn(
                'grid grid-cols-[2rem_minmax(0,1.4fr)_5rem_minmax(0,1fr)_9rem] items-center gap-2 rounded-md border p-2',
                dragIndex === index && 'opacity-50'
              )}
            >
              <span className='flex items-center justify-center'>
                <GripVertical className='text-muted-foreground size-4 cursor-grab' />
              </span>
              <span className='truncate text-sm font-medium' title={row.group}>
                {row.group}
              </span>
              <span className='text-muted-foreground font-mono text-xs'>
                x{ratios[row.group]}
              </span>
              <Input
                value={row.category ?? ''}
                placeholder={t('None')}
                onChange={(e) => updateRow(index, { category: e.target.value })}
                className='h-8 text-xs'
              />
              <Select
                items={[
                  { value: VISIBILITY.AUTO, label: t('Auto (free hidden)') },
                  { value: VISIBILITY.HIDDEN, label: t('Always hidden') },
                  { value: VISIBILITY.SHOWN, label: t('Always shown') },
                ]}
                value={visibilityOf(row)}
                onValueChange={(v) =>
                  v !== null && setVisibility(index, v as Visibility)
                }
              >
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectItem value={VISIBILITY.AUTO}>
                      {t('Auto (free hidden)')}
                    </SelectItem>
                    <SelectItem value={VISIBILITY.HIDDEN}>
                      {t('Always hidden')}
                    </SelectItem>
                    <SelectItem value={VISIBILITY.SHOWN}>
                      {t('Always shown')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        {usedCategories.length > 0 && (
          <div className='space-y-2'>
            <p className='text-sm font-medium'>{t('Categories')}</p>
            {usedCategories.map((category, index) => (
              <div
                key={category.name}
                draggable
                onDragStart={() => setDragCategory(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragCategory !== null) moveCategory(dragCategory, index)
                  setDragCategory(null)
                }}
                onDragEnd={() => setDragCategory(null)}
                className={cn(
                  'flex items-center gap-3 rounded-md border p-2',
                  dragCategory === index && 'opacity-50'
                )}
              >
                <GripVertical className='text-muted-foreground size-4 cursor-grab' />
                <span className='text-sm font-medium'>{category.name}</span>
                <span className='text-muted-foreground ml-auto text-xs'>
                  {t('Expanded by default')}
                </span>
                <Switch
                  checked={category.default_expanded}
                  onCheckedChange={(checked) =>
                    setCategories(
                      usedCategories.map((c, i) =>
                        i === index ? { ...c, default_expanded: checked } : c
                      )
                    )
                  }
                />
              </div>
            ))}
          </div>
        )}

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {t('Save')}
        </Button>
      </CardContent>
    </Card>
  )
}
