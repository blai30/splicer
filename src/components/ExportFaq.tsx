import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { ChevronRight, CircleHelp } from 'lucide-preact'

import { Modal } from '@/components/Modal'
import { assetPath } from '@/lib/paths'

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Why is my exported WebM not smaller or higher quality than the original?',
    answer:
      'WebM is a container, not a codec. Exporting to WebM re-encodes your video with VP8 or VP9, and re-encoding an already-compressed video always loses a little quality. You cannot gain quality by re-encoding, and a smaller file with zero quality loss is not possible this way.',
  },
  {
    question: 'How do I keep quality as high as possible?',
    answer:
      'Every export re-encodes the video, so a perfectly lossless copy is not possible. To stay as close to the source as you can, export to the same format as your source at Lossless quality with FPS left on Original. Lossless targets a very high bitrate for near-transparent quality.',
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

  return (
    <>
      <button
        type="button"
        onClick={() => (isOpen.value = true)}
        class={clsx(
          className,
          'inline-flex h-6 items-center gap-1 rounded-full border border-blue-300 bg-blue-100 px-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-200 hover:duration-0 dark:border-blue-700/60 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60'
        )}
        aria-label="Export and quality FAQ"
        aria-haspopup="dialog"
        title="Export & quality FAQ"
      >
        <CircleHelp class="size-4" />
        FAQ
      </button>
      <Modal
        open={isOpen.value}
        title="Export & quality FAQ"
        onClose={() => (isOpen.value = false)}
      >
        <div class="flex flex-col gap-1 p-4">
          <div class="mb-2 rounded-md border border-violet-200/80 bg-violet-50 p-3 text-sm leading-relaxed text-slate-700 dark:border-violet-800/50 dark:bg-violet-900/20 dark:text-slate-200">
            <p>
              <span class="font-semibold text-violet-700 dark:text-violet-300">TL;DR:</span> For the
              highest-quality export, keep the format the same as your source video and leave
              quality on Lossless and FPS on Original. Every export re-encodes in the browser, so
              Lossless aims for near-transparent quality rather than a perfect copy.
            </p>
          </div>

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
                Re-encoding always loses a little quality, and H.264 cannot live in a WebM
                container, so there is no zero-loss path from an MP4 to WebM.
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
      </Modal>
    </>
  )
}
