# splicer
## Description
Browser-based application that can edit video clips by cutting, trimming, concatenating video files in .mp4, .mkv, .webm, .avi, .mov, and more formats using the FFMPEG WASM library entirely client-sided. Users can drag and drop video files from their desktop into the web page to import, edit the video files as they please, and finally export the finished video in any format, even if the original formats are different.

## Features
- Preview video player for the user to easily review and playback the video before exporting
- Drag-and-drop video files
- Download link that can also be dragged out of the browser window so the user can drop the file anywhere on their desktop
- Ability to trim, concatenate, and cut video clips
  - Bonus: Cropping to any aspect ratio, repositioning the video into the frame
- Ability to remove audio from the original video files

## Development stack
- Framework: Astro v6.3 (released May 7, 2026)
- Language: TypeScript
- Styling: Tailwind CSS v4.2
- Package Manager: pnpm
