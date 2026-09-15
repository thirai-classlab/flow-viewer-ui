import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /**
   * これが変わるとエラー状態を捨てて描画をやり直す。
   * データや表示モードを変えれば復帰できるようにするための鍵で、
   * 「一度落ちたら再読み込みするしかない」状態を避ける。
   */
  resetKey: string
}

type State = { error: Error | null }

/**
 * キャンバスがクラッシュしてもシェル（ツールバー・JSON パネル）は生かす。
 *
 * JSON パネルが生きていれば、落ちた原因のデータをその場で確認・修正できる。
 * エラーは握りつぶさずそのまま画面に出す。
 */
export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[canvas] 描画中にクラッシュしました', error, info)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div className="notice err">
          <strong>キャンバスが描画中にクラッシュしました</strong>
          <pre className="trace">
            {error.message}
            {error.stack ? `\n\n${error.stack.split('\n').slice(0, 8).join('\n')}` : ''}
          </pre>
          <p className="hint">
            データか表示モードを変えると再描画を試みます。右の JSON パネルで原因のデータを確認できます。
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
