// Opening videos from the OS once Splicer is installed: the manifest's
// file_handlers route them here through the Launch Handler API (Chromium only;
// elsewhere this does nothing).

type LaunchFileHandle = { kind: string; getFile: () => Promise<File> }
export type LaunchParams = { files?: readonly LaunchFileHandle[] }
export type LaunchQueue = { setConsumer: (consumer: (params: LaunchParams) => void) => void }

// The Files behind a launch's handles. A handle that cannot be read (moved or
// deleted since) is skipped rather than failing the rest.
export async function filesFromLaunch(params: LaunchParams): Promise<File[]> {
  const handles = (params.files ?? []).filter((handle) => handle.kind === 'file')
  const results = await Promise.allSettled(handles.map((handle) => handle.getFile()))
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

// Returns false when the browser has no launch queue.
export function consumeLaunchedFiles(
  host: { launchQueue?: LaunchQueue },
  importLaunched: (files: File[]) => void
): boolean {
  const queue = host.launchQueue
  if (!queue || typeof queue.setConsumer !== 'function') return false
  queue.setConsumer((params) => {
    void filesFromLaunch(params).then((files) => {
      if (files.length > 0) importLaunched(files)
    })
  })
  return true
}
