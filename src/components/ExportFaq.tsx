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
      'Pick Original (no re-encode). It copies the source video as it is, so there is no quality loss and the file is about the size of the source. It works in Basic mode when every clip comes from the same kind of camera or encoder, nothing is cropped, FPS and Resolution are on Original, and the format can hold the source codec (MP4, MOV or MKV for H.264; WebM or MKV for VP9). When Original is unavailable, the button says why. Otherwise, export to the same format as your source at Maximum quality with FPS on Original.',
  },
  {
    question: 'Why does an Original export start a little before my cut?',
    answer:
      'Compressed video stores a full picture only every so often (a key frame) and the frames between depend on it. A copy has to start on a key frame, so each cut moves back to the key frame before it. The panel lists how far each cut moves, and the timeline shows a dashed line. Phones usually place key frames every 1 to 2 seconds; screen recordings can go 10 seconds or more, in which case a quality preset gives an exact cut. Audio is re-encoded to line up with the copied video.',
  },
  {
    question: 'How do I make a file that fits a size limit?',
    answer:
      'Pick Target size and choose 8, 10, 25 or 50 MB, or type a size. The export aims a little under it to leave room. If that leaves too few bits for a clear picture at the current size, it lowers the resolution, then the frame rate, and tells you. If even 360p cannot fit, it tells you the smallest size that can. To shrink a file at any quality, you can also lower the Resolution yourself.',
  },
  {
    question: 'Should I use VP8 or VP9?',
    answer:
      'VP9 is more efficient and produces smaller files at similar quality. VP8 is older and roughly matches the H.264 in most MP4s, so it can produce a larger file than your source. Pick VP9 for smaller sizes, or VP8 for faster encoding.',
  },
  {
    question: 'What do the quality presets do?',
    answer:
      'They set the target bitrate relative to your source, scaled to the output size: Maximum up to 1.5x the source bitrate, High about the same as the source, Medium about 60%, and Low about 35%. When the source bitrate cannot be measured, they fall back to fixed bitrates for the output size. Maximum is not mathematically lossless.',
  },
  {
    question: 'Will exporting make my file smaller?',
    answer:
      'Medium and Low aim below the source bitrate, and High aims at it. The size shown next to the Export button is an estimate with a likely range and your source size for comparison. One limit: the browser encoder cannot go below a minimum bitrate for a given resolution, so a source that is already very compressed (common for screen recordings) can come out larger at any quality. The panel tells you when that happens.',
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
              quality on Original (no re-encode), which copies the video without any loss. When
              Original is unavailable, use Maximum, or High for a file about the size of your
              source. Target size fits a size limit.
            </p>
          </div>

          <div class="mb-2 rounded-md border border-slate-200/70 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-300">
            <p class="mb-2 font-medium text-slate-800 dark:text-slate-100">
              Exporting an MP4 to WebM always re-encodes your video, which loses a little quality:
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
