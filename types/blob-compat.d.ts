export {};

declare global {
  interface BlobConstructor {
    new (
      blobParts?: Iterable<BlobPart | Uint8Array<ArrayBufferLike>>,
      options?: BlobPropertyBag,
    ): Blob;
  }
}
