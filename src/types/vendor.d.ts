// mammoth ships a prebuilt browser bundle without its own type declarations.
declare module 'mammoth/mammoth.browser.min.js' {
  interface ConvertResult {
    value: string;
    messages: { type: string; message: string }[];
  }
  interface Options {
    styleMap?: string[];
    includeDefaultStyleMap?: boolean;
  }
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Options): Promise<ConvertResult>;
  };
  export default mammoth;
}
