declare module "dcmjs" {
  interface DicomFile {
    dict: Record<string, unknown>;
    meta: Record<string, unknown>;
  }

  const dcmjs: {
    data: {
      DicomMessage: {
        readFile(buffer: ArrayBuffer | SharedArrayBuffer): DicomFile;
      };
      DicomMetaDictionary: {
        naturalizeDataset(dataset: unknown): unknown;
      };
      datasetToBuffer(dataset: unknown): Uint8Array;
    };
  };

  export default dcmjs;
}
