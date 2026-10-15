// -----------------------------------------------------------------------------
// Camera images, made to fit Gladys.
//
// Gladys takes camera images as an `image/jpg;base64,…` string of 150 KB at
// most (the whole string, SDK MAX_CAMERA_IMAGE_SIZE). Blue Iris scales and
// compresses its images itself (`/image/<camera>?w=…&q=…`), so instead of
// decoding a JPEG in a 256 MB sandbox, the integration asks again for a
// smaller one when an image is too large: no image library at all.
// -----------------------------------------------------------------------------

export const CAMERA_PREFIX = 'image/jpg;base64,';
export const MAX_CAMERA_IMAGE = 150 * 1024; // the full string, prefix included

// Tried in order until the image fits: a 1080p view at 70 % is usually
// 100-200 KB, 960 px at 60 % about half.
export const IMAGE_STEPS = Object.freeze([
  { width: 1280, quality: 70 },
  { width: 960, quality: 60 },
  { width: 640, quality: 50 },
  { width: 480, quality: 40 },
]);

export const fitsCamera = (bytes) =>
  CAMERA_PREFIX.length + Math.ceil(bytes.length / 3) * 4 <= MAX_CAMERA_IMAGE;

/** The `image/jpg;base64,…` string of JPEG bytes. */
export const asCameraImage = (bytes) => `${CAMERA_PREFIX}${Buffer.from(bytes).toString('base64')}`;

/**
 * A camera image that fits Gladys.
 * @param {(options: { width: number, quality: number }) => Promise<Buffer>} read
 * @returns {Promise<string>} the `image/jpg;base64,…` string
 */
export async function fittedCameraImage(read) {
  let size = 0;
  for (const step of IMAGE_STEPS) {
    const bytes = await read(step);
    if (fitsCamera(bytes)) {
      return asCameraImage(bytes);
    }
    size = bytes.length;
  }
  throw new Error(`The image stays too large for Gladys (${Math.round(size / 1024)} KB)`);
}
