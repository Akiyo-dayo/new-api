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
export type NoticePopupState = {
  notice: string
  noticeKey: string
  popupEnabled: boolean
  loading: boolean
  dismissed: boolean
}

function hashString(input: string): string {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return hash.toString(36)
}

export function buildNoticeKey(notice: string, revision: string): string {
  return `notice:${revision}:${hashString(notice.trim())}`
}

export function shouldOpenNoticePopup(state: NoticePopupState): boolean {
  return (
    !state.loading &&
    state.popupEnabled &&
    state.notice.trim().length > 0 &&
    state.noticeKey.length > 0 &&
    !state.dismissed
  )
}
