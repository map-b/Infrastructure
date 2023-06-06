/**
 * Represents a GitHub repository.
 */
export interface IRepoModel {
	/**
	 * Gets or sets the node ID of the repository.
	 */
	node_id: string;

	/**
	 * Gets or sets the name of the repository.
	 */
	name: string;

	/**
	 * Gets or sets the full name of the repository.
	 */
	full_name: string;

	/**
	 * Gets or sets the URL of the repository.
	 */
	html_url: string;
}