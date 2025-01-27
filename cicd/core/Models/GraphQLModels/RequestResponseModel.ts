import { ErrorModel } from "./ErrorModel.ts";

/**
 * Represents a request response.
 */
export type RequestResponseModel = {
	/**
	 * The data returned from the request.
	 */
	// deno-lint-ignore no-explicit-any
	data: any;

	/**
	 * The errors returned from the request.
	 */
	errors?: ErrorModel[];
};
