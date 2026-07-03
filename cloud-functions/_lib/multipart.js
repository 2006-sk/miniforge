/**
 * Read multipart form: fields "image", "userId", optional "profile" JSON.
 */
export async function readScanForm(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    try {
      const body = await request.json();
      if (body?.imageBase64 && body?.userId) {
        return {
          userId: String(body.userId),
          imageBase64: body.imageBase64,
          mime: body.mime || 'image/jpeg',
          profile: body.profile || null,
        };
      }
    } catch {
      /* fall through */
    }
    throw new Error('Expected multipart/form-data with image + userId');
  }

  const form = await request.formData();
  const userId = form.get('userId');
  const image = form.get('image');
  const profileRaw = form.get('profile');

  if (!userId || typeof userId !== 'string') {
    throw new Error('userId is required');
  }
  if (!image || typeof image === 'string') {
    throw new Error('image file is required');
  }

  let profile = null;
  if (typeof profileRaw === 'string' && profileRaw.trim()) {
    try {
      profile = JSON.parse(profileRaw);
    } catch {
      profile = null;
    }
  }

  const buf = Buffer.from(await image.arrayBuffer());
  return {
    userId,
    imageBase64: buf.toString('base64'),
    mime: image.type || 'image/jpeg',
    profile,
  };
}
