/**
 * 情報パネル。
 *
 * ベンチマークアプリの InspectorPanel から「ライブラリ比較のための meta 表示」を落とし、
 * 残したのは 2 つ:
 *   - テストケースを選んでいるときの「このデータで何を検証するか」
 *   - 共通アルゴリズム（src/flow）が今どう解釈しているか
 *
 * 後者は描画結果を疑うときの基準値になる。図が変に見えたとき、
 * 「データの解釈が変」なのか「LogicFlow の描画が変」なのかをここで切り分けられる。
 */

import { useMemo } from 'react'
import type { FlowDoc } from '../flow/schema'
import type { FlatDoc } from '../flow/flatten'
import type { ViewMode } from '../flow/view-props'
import {
  edgesAtLevel,
  hasUniformExternalConnectivity,
  nodesAtLevel,
  rewriteEdges,
} from '../flow/collapse'
import type { TestCase } from '../flow/cases'

type Props = {
  doc: FlowDoc
  flat: FlatDoc
  viewMode: ViewMode
  collapsed: ReadonlySet<string>
  drillRoot: string | null
  /** テストケースを選んでいる場合のみ */
  testCase?: TestCase
}

export function InfoPanel({ doc, flat, viewMode, collapsed, drillRoot, testCase }: Props) {
  const isDrill = viewMode !== 'nested'

  const edges = useMemo(
    () => rewriteEdges(doc.links, flat.parentOf, collapsed),
    [doc.links, flat.parentOf, collapsed],
  )

  const level = useMemo(
    () => edgesAtLevel(doc.links, flat.parentOf, drillRoot),
    [doc.links, flat.parentOf, drillRoot],
  )

  const levelNodes = useMemo(
    () => nodesAtLevel(flat.nodes, flat.parentOf, drillRoot),
    [flat.nodes, flat.parentOf, drillRoot],
  )

  const uniform = useMemo(
    () =>
      flat.containerIds.filter((id) => {
        const node = flat.byId.get(id)
        if (!node) return false
        return hasUniformExternalConnectivity(id, node.childIds, doc.links)
      }),
    [flat, doc.links],
  )

  const aggregated = edges.filter((e) => e.aggregated)

  return (
    <div className="info-panel">
      {testCase && (
        <>
          <h3>このデータで検証すること</h3>
          <div className="block">
            <div className="strong-line">{testCase.label}</div>
            <p className="para">{testCase.purpose}</p>
            <div className="chip-list">
              {testCase.stress.map((s) => (
                <span key={s} className="chip static">
                  {s}
                </span>
              ))}
            </div>
            {testCase.expectation && (
              <p className="para dim">
                <strong className="warn">予想: </strong>
                {testCase.expectation}
              </p>
            )}
          </div>
        </>
      )}

      <h3>このフロー</h3>
      <div className="block">
        <div className="strong-line">{doc.title}</div>
        {doc.description && <p className="para dim">{doc.description}</p>}
        <div className="para">
          {flat.nodes.length} ノード（グループ {flat.containerIds.length}）/ {doc.links.length} リンク
        </div>
      </div>

      <h3>共通アルゴリズムの結果</h3>

      {isDrill ? (
        <div className="block">
          <div className="para">
            現在の階層:{' '}
            <strong>{drillRoot === null ? 'トップ' : (flat.byId.get(drillRoot)?.label ?? drillRoot)}</strong>
            <br />
            この階層に見えるノード <strong>{levelNodes.length}</strong> 個 / エッジ{' '}
            <strong>{level.edges.length}</strong> 本（全 {doc.links.length} 本中）
          </div>
          {level.outOfScope.length > 0 && (
            <p className="para warn">
              <strong>{level.outOfScope.length} 本</strong> がこの階層のスコープを出入りしています。
              <br />
              階層を 1 枚ずつ見せる以上「画面の外へ出る線」は必ず生まれます。
              黙って消すとフローが途切れて見えるため、キャンバス側は境界マーカーで示しています。
            </p>
          )}
          {levelNodes.filter((n) => n.isContainer).length > 0 && (
            <p className="para dim">
              このうち{' '}
              {levelNodes
                .filter((n) => n.isContainer)
                .map((n) => n.label)
                .join(' / ')}{' '}
              は中身を持つ箱です。潜ると中の階層が見えます。
            </p>
          )}
        </div>
      ) : (
        <div className="block">
          <div className="para">
            折りたたみ中 <strong>{collapsed.size}</strong> / エッジ {doc.links.length} 本 →{' '}
            <strong>{edges.length}</strong> 本
            {aggregated.length > 0 && `（うち ${aggregated.length} 本は集約）`}
          </div>
          {aggregated.length > 0 && (
            <ul>
              {aggregated.map((e) => (
                <li key={e.id}>
                  <code>
                    {flat.byId.get(e.source)?.label ?? e.source} →{' '}
                    {flat.byId.get(e.target)?.label ?? e.target}
                  </code>{' '}
                  に {e.children.length} 本を集約
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {uniform.length > 0 && (
        <p className="para dim">
          <code>hasUniformExternalConnectivity</code> が true になるグループ:{' '}
          {uniform.map((id) => flat.byId.get(id)?.label ?? id).join(' / ')}
          <br />
          （全子ノードの外部接続が同一 = N 本を 1 本に畳んでよい）
        </p>
      )}
    </div>
  )
}
