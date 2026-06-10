import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { ChevronRight, CircleHelp, X } from 'lucide-preact'
import { createPortal } from 'preact/compat'
import { useEffect } from 'preact/hooks'

import { assetPath } from '@/lib/paths'

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Why is my exported WebM not smaller or higher quality than the original?',
    answer:
      'WebM is a container, not a codec. Exporting to WebM re-encodes your video with VP8 or VP9, and re-encoding an already-compressed video always loses a little quality. You cannot gain quality by re-encoding, and a smaller file with zero quality loss is not possible this way.',
  },
  {
    question: 'How do I export without losing any quality?',
    answer:
      'Export to the same format as your source, at Lossless quality, with FPS left on Original and without cropping or muting. Splicer then copies the video stream directly instead of re-encoding, so there is no quality loss and it finishes almost instantly. Trimming is still fine; changing the format, FPS, cropping, or muting forces a re-encode.',
  },
  {
    question: 'Should I use VP8 or VP9?',
    answer:
      'VP9 is more efficient and produces smaller files at similar quality. VP8 is older and roughly matches the H.264 in most MP4s, so it can produce a larger file than your source. Pick VP9 for smaller sizes, or VP8 for faster encoding.',
  },
  {
    question: 'What do the quality presets do?',
    answer:
      'They set the target bitrate for the re-encode, from highest (Lossless) to lowest (Low). "Lossless" aims for near-transparent quality at a very high bitrate; it is not mathematically lossless. Higher quality means larger files.',
  },
  {
    question: 'Will exporting make my file smaller?',
    answer:
      'Only if your source was encoded inefficiently and you choose an efficient codec like VP9. An already well-compressed source may actually get larger when re-encoded.',
  },
]

export function ExportFaq({ class: className }: { class?: string }) {
  const isOpen = useSignal(false)

  useEffect(() => {
    if (!isOpen.value) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        isOpen.value = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen.value])

  const modal =
    isOpen.value && typeof document !== 'undefined' ? (
      <div
        class="fixed inset-0 z-999 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        onClick={() => (isOpen.value = false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Export and quality FAQ"
          class="relative max-h-[80vh] w-full max-w-lg scrollbar-thumb-slate-400/80 scrollbar-track-transparent overflow-auto rounded-lg border border-slate-200/80 bg-white shadow-lg dark:scrollbar-thumb-slate-600/80 dark:border-slate-700/70 dark:bg-slate-900"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="sticky top-0 flex items-center justify-between border-b border-slate-200/60 bg-white px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Export &amp; quality FAQ
            </h2>
            <button
              onClick={() => (isOpen.value = false)}
              class="inline-flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-slate-100 hover:duration-0 dark:hover:bg-slate-800"
              aria-label="Close"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <div class="flex flex-col gap-1 p-4">
            <div class="mb-2 rounded-md border border-slate-200/70 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-300">
              <p class="mb-2 font-medium text-slate-800 dark:text-slate-100">
                Exporting to WebM always re-encodes your video, which loses a little quality:
              </p>
              <ul class="flex flex-col gap-1.5 pl-4">
                <li class="list-disc">
                  Your source is already lossy. Its original codec (for example the H.264 in an MP4)
                  discarded data when the video was first encoded.
                </li>
                <li class="list-disc">
                  Exporting to WebM decodes the video back to raw pixels, then re-encodes them with
                  VP8 or VP9. That second encode is also lossy. This is called generation loss, like
                  photocopying a photocopy.
                </li>
                <li class="list-disc">
                  The only way to lose zero quality is to not re-encode at all (stream-copy). But
                  H.264 cannot live in a WebM container, so WebM export always re-encodes. There is
                  no zero-loss path from an MP4 to WebM.
                </li>
              </ul>
            </div>

            {FAQ_ITEMS.map((item) => (
              <details key={item.question} class="group/item rounded-md">
                <summary class="flex list-none items-start gap-1.5 rounded-md px-2 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:duration-0 dark:text-slate-300 dark:hover:bg-slate-800/60">
                  <ChevronRight class="mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform group-open/item:rotate-90" />
                  <span class="font-medium">{item.question}</span>
                </summary>
                <p class="px-2 pt-1 pb-2 pl-7 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {item.answer}
                </p>
              </details>
            ))}

            <a
              href={assetPath('about/')}
              class="mt-1 inline-flex w-fit items-center gap-1 px-2 text-sm font-medium text-violet-600 hover:text-violet-700 hover:underline dark:text-violet-400 dark:hover:text-violet-300"
            >
              Read more about export quality and formats
              <ChevronRight class="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    ) : null

  return (
    <>
      <button
        onClick={() => (isOpen.value = !isOpen.value)}
        class={clsx(
          className,
          'inline-flex h-6 items-center gap-1 rounded-full border border-blue-300 bg-blue-100 px-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-200 hover:duration-0 dark:border-blue-700/60 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60'
        )}
        aria-label="Export and quality FAQ"
        title="Export &amp; quality FAQ"
      >
        <CircleHelp class="size-4" />
        FAQ
      </button>
      {modal ? createPortal(modal, document.body) : null}
    </>
  )
}
