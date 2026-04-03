// @ts-check

export class HttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = "HttpError";
    /** @type {number} */
    this.statusCode = statusCode;
    /** @type {unknown} */
    this.details = details;
  }
}
