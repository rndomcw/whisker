// scrcpy 4.0 wire protocol constants (forward tunnel, video + control, no audio).
//
//   video socket: dummy byte, 64-byte device name, u32 codec id, then 12-byte headers, each either
//     a session packet  (u32 flags with bit 31 set, u32 width, u32 height) or
//     a media packet    (u64 pts|flags, u32 size) followed by `size` bytes.
//   control socket: opened second; the renderer builds the control messages.

/** Must match vendor/scrcpy/scrcpy-server exactly, or the server refuses to start. */
export const SCRCPY_VERSION = '4.0';
export const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar';

export const DEVICE_NAME_LENGTH = 64;
export const HEADER_LENGTH = 12;
export const CODEC_H264 = 0x68323634; // "h264"

export const FLAG_SESSION = 1n << 63n;
export const FLAG_CONFIG = 1n << 62n;
export const FLAG_KEY_FRAME = 1n << 61n;
export const PTS_MASK = FLAG_KEY_FRAME - 1n;
