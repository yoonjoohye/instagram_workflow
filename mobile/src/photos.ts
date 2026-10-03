/** 기기 사진첩: 목록·썸네일·원본(줄인 JPEG)·저장. 웹 화면이 다리(bridge)로 요청합니다. */
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  Asset,
  AssetField,
  getPermissionsAsync,
  MediaType,
  Query,
  requestPermissionsAsync,
} from "expo-media-library";

export type PhotoMeta = { id: string; filename: string | null; creationTime: number | null };
export type Thumb = { id: string; b64: string; lat: number | null; lng: number | null };

export async function permission(request: boolean): Promise<{ granted: boolean }> {
  const res = request ? await requestPermissionsAsync() : await getPermissionsAsync();
  return { granted: res.granted };
}

/** 최근 사진부터 (사진만, 동영상 제외) */
export async function listPhotos(offset: number, limit: number): Promise<PhotoMeta[]> {
  const rows = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .offset(offset)
    .limit(limit)
    .exeForMetadata();
  return rows.map((r) => ({ id: r.id, filename: r.filename, creationTime: r.creationTime }));
}

async function resized(id: string, side: number, compress: number): Promise<{ b64: string; asset: Asset }> {
  const asset = new Asset(id);
  const [uri, width, height] = await Promise.all([asset.getUri(), asset.getWidth(), asset.getHeight()]);
  const scale = Math.min(1, side / Math.max(width || side, height || side));
  const ctx = ImageManipulator.manipulate(uri);
  if (scale < 1) ctx.resize(width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
  return { b64: out.base64 ?? "", asset };
}

/** 분석·미리보기용 작은 이미지 + 촬영 위치 */
export async function thumbnails(ids: string[], side: number): Promise<Thumb[]> {
  const out: Thumb[] = [];
  for (const id of ids) {
    try {
      const { b64, asset } = await resized(id, side, 0.8);
      const loc = await asset.getLocation().catch(() => null);
      out.push({ id, b64, lat: loc?.latitude ?? null, lng: loc?.longitude ?? null });
    } catch {
      // iCloud 에만 있는 사진 등은 건너뜀
    }
  }
  return out;
}

/** 게시물에 쓸 사진 (긴 변 1600px JPEG) */
export async function photo(id: string): Promise<{ b64: string; filename: string }> {
  const { b64, asset } = await resized(id, 1600, 0.9);
  return { b64, filename: (await asset.getFilename().catch(() => null)) || "photo.jpg" };
}

/** 만든 게시물 이미지·동영상을 사진첩에 저장 */
export async function save(urls: string[]): Promise<number> {
  const { granted } = await requestPermissionsAsync();
  if (!granted) throw new Error("permission denied");
  const dir = new Directory(Paths.cache, "downloads");
  if (!dir.exists) dir.create();
  let saved = 0;
  for (const url of urls) {
    const file = await File.downloadFileAsync(url, dir, { idempotent: true });
    await Asset.create(file.uri);
    file.delete();
    saved++;
  }
  return saved;
}
