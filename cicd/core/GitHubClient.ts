import { WebAPIClient } from "./WebAPIClient.ts";
import { Utils } from "./Utils.ts";
import { LinkHeaderParser } from "./LinkHeaderParser.ts";
import { GetDataFunc } from "./Types.ts";

/**
 * Provides a base class for HTTP clients.
 */
export abstract class GitHubClient extends WebAPIClient {
	private headerParser: LinkHeaderParser = new LinkHeaderParser();
	protected readonly organization = "KinsonDigital";
	protected readonly headers: Headers = new Headers();

	/**
	 * Initializes a new instance of the {@link WebAPIClient} class.
	 * @param token The GitHub token to use for authentication.
	 * @remarks If no token is provided, then the client will not be authenticated.
	 */
	constructor(token?: string) {
		super();

		this.baseUrl = "https://api.github.com";
		this.headers.append("Accept", "application/vnd.github+json");
		this.headers.append("X-GitHub-Api-Version", "2022-11-28");

		if (!Utils.isNullOrEmptyOrUndefined(token)) {
			this.headers.append("Authorization", `Bearer ${token}`);
		}
	}

	/**
	 * Returns a value indicating whether or not a token was provided.
	 * @returns True if a token was provided; otherwise, false.
	 */
	protected containsToken(): boolean {
		return this.headers.has("Authorization");
	}

	/**
	 * Gets all data starting at the given {@link page} with a quantity for each page using the given {@link qtyPerPage}.
	 * @param getData The function to use to get the data for each page.
	 * @param qtyPerPage The quantity of items to get per page.
	 * @returns All of the data from the given {@link page}.
	 */
	protected async getAllData<T>(
		getData: GetDataFunc<T>,
		page = 1,
		qtyPerPage = 100,
	): Promise<T[]> {
		const allData: T[] = [];

		page = page < 1 ? 1 : page;
		qtyPerPage = Utils.clamp(qtyPerPage, 1, 100);

		let totalPages = 0;

		try {
			// Get data for the current page
			const [dataItems, response] = await getData(page, qtyPerPage);

			totalPages += 1;
			// Push the first page of data
			allData.push(...dataItems);

			const linkHeader = this.headerParser.toLinkHeader(response);
			const totalPagesLeft = linkHeader === null ? 1 : linkHeader?.totalPages ?? 0;

			const dataRequests: Promise<[T[], Response]>[] = [];

			// Gather all of the requests promises
			for (let i = 2; i <= totalPagesLeft; i++) {
				const request = getData(i, qtyPerPage);

				dataRequests.push(request);
			}

			const responses: [T[], Response][] = await Promise.all(dataRequests);

			// Add the rest of the pages of data
			for (let i = 0; i < responses.length; i++) {
				const [pageData] = responses[i];

				allData.push(...pageData);
			}

			totalPages += dataRequests.length;
		} catch (error) {
			let errorMsg = "There was an issue getting all of the data using pagination.";
			errorMsg += `\n${error.message}`;
			Utils.printAsGitHubError(errorMsg);
			Deno.exit(1);
		}

		return allData;
	}

	/**
	 * Gets all data starting at the given {@link page} with a quantity for each page using the given {@link qtyPerPage},
	 * until the given {@link getData} predicate returns true.
	 * @param getData The function to use to get the data for each page.
	 * @param qtyPerPage The quantity of items to get per page.
	 * @returns All of the data from the given {@link page}.
	 */
	protected async getAllDataUntil<T>(
		getData: GetDataFunc<T>,
		page = 1,
		qtyPerPage = 100,
		until: (pageOfData: T[]) => boolean,
	): Promise<T[]> {
		page = page < 1 ? 1 : page;
		qtyPerPage = Utils.clamp(qtyPerPage, 1, 100);

		try {
			// Get data for the current page
			const [dataItems, response] = await getData(page, qtyPerPage);

			// If the until predicate returns true on the first page,
			// then there is no need to get any more data.
			if (until(dataItems)) {
				return dataItems;
			}

			const linkHeader = this.headerParser.toLinkHeader(response);
			const totalPagesLeft = linkHeader?.totalPages ?? 0;

			let [groupA, groupB] = this.createAlternatePagesGroups(totalPagesLeft);

			// Remove the first page, this has already been pulled
			groupA = groupA.filter((i) => i != 1);
			groupB = groupB.filter((i) => i != 1);

			const maxLen = Math.max(groupA.length, groupB.length);

			const requests: Promise<[T[], Response]>[] = [];

			for (let i = 0; i < maxLen; i++) {
				if (i <= groupA.length - 1) {
					const currentPageA = groupA[i];

					requests.push(getData(currentPageA, qtyPerPage));
				}

				if (i <= groupB.length - 1) {
					const currentPageB = groupB[i];

					requests.push(getData(currentPageB, qtyPerPage));
				}

				// Wait for both requests from each group to finish
				const [groupResultA, groupResultB] = await Promise.all(requests);

				const groupItemsA = groupResultA === undefined ? [] : groupResultA[0];

				// Does the result from group A contain the data
				if (groupItemsA.length > 0 && until(groupItemsA)) {
					return groupItemsA;
				}

				const groupItemsB = groupResultB === undefined ? [] : groupResultB[0];

				// Does the result from group B contain the data
				if (groupItemsB.length > 0 && until(groupItemsB)) {
					return groupItemsB;
				}

				// Clear all of the items
				requests.length = 0;
			}

			return [];
		} catch (error) {
			let errorMsg = "There was an issue getting all of the data using pagination.";
			errorMsg += `\n${error.message}`;

			Utils.printAsGitHubError(errorMsg);
			Deno.exit(1);
		}
	}

	/**
	 * Gets all data starting at the given {@link page} with a quantity for each using the given {@link qtyPerPage},
	 * with each page of data being filtered with the given {@link getData} function.
	 * @param getData The function to use to get the data for each page.
	 * @param qtyPerPage The quantity of items to get per page.
	 * @returns All of the data from the given {@link page}.
	 */
	protected async getAllFilteredData<T>(
		getData: GetDataFunc<T>,
		page = 1,
		qtyPerPage = 100,
		filter: (pageOfData: T[]) => T[],
	): Promise<T[]> {
		page = page < 1 ? 1 : page;
		qtyPerPage = Utils.clamp(qtyPerPage, 1, 100);

		try {
			return filter(await this.getAllData(getData, page, qtyPerPage));
		} catch (error) {
			let errorMsg = "There was an issue getting all of the data using pagination.";
			errorMsg += `\n${error.message}`;
			Utils.printAsGitHubError(errorMsg);
			Deno.exit(1);
		}
	}

	/**
	 * Creates 2 groups of pages from the given {@link totalPages}.
	 * @param totalPages The total number of pages to create groups from.
	 * @returns The first and second half of the pages.
	 * @remarks The first half of pages will be in ascending order, while the second half will be in descending order.
	 * This will make sure that when requests are fired from both groups, the requests will be made in an alternating order.
	 */
	private createAlternatePagesGroups(totalPages: number): [number[], number[]] {
		const firstHalf: number[] = [];
		const secondHalf: number[] = [];

		const firstHalfEndingIndex = Math.floor(totalPages / 2);

		for (let i = 1; i <= totalPages; i++) {
			if (i <= firstHalfEndingIndex) {
				firstHalf.push(i);
			} else {
				secondHalf.push(i);
			}
		}

		secondHalf.reverse();

		return [firstHalf, secondHalf];
	}
}
