/**
 * 音源がそこに置かれているかを確かめる。
 *
 * <audio> の読み込み完了（canplay）を待って判断すると、遅い回線や
 * 環境によっては何十秒もかかり、実際には在る音源を「無い」と誤って
 * 表示してしまう。存在の確認と、再生できるかどうかは別の話なので、
 * ここでは HEAD だけを見る。実際に鳴らせるかは play() が答える。
 */
export async function probeTrack(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(url, { method: 'HEAD' })
    if (!response.ok) return false
    // 開発用サーバーは、見つからない時に index.html を返すことがある。
    // 200 が返っただけでは足りないので、種類まで確かめる
    return (response.headers.get('content-type') ?? '').startsWith('audio/')
  } catch {
    // 通信そのものが失敗した時も「無い」として扱う。画面は音無しで成立する
    return false
  }
}
