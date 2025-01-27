import { OrgClient } from "../../clients/OrgClient.ts";
import { RepoClient } from "../../clients/RepoClient.ts";
import { TwitterClient } from "../../clients/TwitterClient.ts";
import { GitHubLogType } from "../../core/Enums.ts";
import { ReleaseTweetBuilder } from "../../core/ReleaseTweetBuilder.ts";
import { GitHubVariableService } from "../../core/Services/GitHubVariableService.ts";
import { TwitterAuthValues } from "../../core/TwitterAuthValues.ts";
import { Utils } from "../../core/Utils.ts";
import { ScriptRunner } from "./ScriptRunner.ts";

/**
 * Sends release tweets.
 */
export class SendReleaseTweetRunner extends ScriptRunner {
	private static readonly TWITTER_BROADCAST_ENABLED = "TWITTER_BROADCAST_ENABLED";
	private static readonly DISCORD_INVITE_CODE = "DISCORD_INVITE_CODE";
	private static readonly RELEASE_TWEET_TEMPLATE_REPO_NAME = "RELEASE_TWEET_TEMPLATE_REPO_NAME";
	private static readonly RELEASE_TWEET_TEMPLATE_BRANCH_NAME = "RELEASE_TWEET_TEMPLATE_BRANCH_NAME";
	private static readonly RELATIVE_RELEASE_TWEET_TEMPLATE_FILE_PATH = "RELATIVE_RELEASE_TWEET_TEMPLATE_FILE_PATH";
	private readonly githubVarService: GitHubVariableService;

	/**
	 * Initializes a new instance of the {@link SendReleaseTweetRunner} class.
	 * @param args The arguments to process.
	 */
	constructor(args: string[]) {
		super(args);
		this.githubVarService = new GitHubVariableService(this.token);
	}

	public async run(): Promise<void> {
		await super.run();

		const [orgName, repoName, version, consumerAPIKey, consumerAPISecret, accessTokenKey, accessTokenSecret] = this.args;

		this.githubVarService.setOrgAndRepo(orgName, repoName);

		let twitterBroadcastEnabled = await this.githubVarService.getValue(
			SendReleaseTweetRunner.TWITTER_BROADCAST_ENABLED,
			false,
		);
		twitterBroadcastEnabled = twitterBroadcastEnabled.toLowerCase();

		if (Utils.isNullOrEmptyOrUndefined(twitterBroadcastEnabled) || twitterBroadcastEnabled === "false") {
			let noticeMsg = `No tweet broadcast will be performed.`;
			noticeMsg +=
				`\nTo enable tweet broadcasting, set the '${SendReleaseTweetRunner.TWITTER_BROADCAST_ENABLED}' variable to 'true'.`;
			noticeMsg += "\nIf the variable is missing, empty, or set to 'false', no tweet broadcast will be performed.";
			Utils.printAsGitHubNotice(noticeMsg);
			Deno.exit(0);
		}

		const discordInviteCode = await this.githubVarService.getValue(SendReleaseTweetRunner.DISCORD_INVITE_CODE, false);
		const templateRepoName = await this.githubVarService.getValue(
			SendReleaseTweetRunner.RELEASE_TWEET_TEMPLATE_REPO_NAME,
			false,
		);
		const templateBranchName = await this.githubVarService.getValue(
			SendReleaseTweetRunner.RELEASE_TWEET_TEMPLATE_BRANCH_NAME,
			false,
		);
		const relativeTemplateFilePath = await this.githubVarService.getValue(
			SendReleaseTweetRunner.RELATIVE_RELEASE_TWEET_TEMPLATE_FILE_PATH,
			false,
		);

		const authValues: TwitterAuthValues = {
			consumer_api_key: consumerAPIKey,
			consumer_api_secret: consumerAPISecret,
			access_token_key: accessTokenKey,
			access_token_secret: accessTokenSecret,
		};

		const tweetBuilder: ReleaseTweetBuilder = new ReleaseTweetBuilder();

		const tweet = await tweetBuilder.buildTweet(
			orgName,
			templateRepoName,
			templateBranchName,
			relativeTemplateFilePath,
			repoName,
			version,
			discordInviteCode,
		);

		const twitterClient: TwitterClient = new TwitterClient(authValues);
		await twitterClient.tweet(tweet);

		const noticeMsg = `A release tweet was successfully broadcasted for the '${repoName}' project for version '${version}'.`;
		Utils.printAsGitHubNotice(noticeMsg);
	}

	/**
	 * @inheritdoc
	 */
	protected async validateArgs(args: string[]): Promise<void> {
		if (Deno.args.length != 8) {
			const errorMsg = `The cicd script must have 8 arguments but has ${args.length} argument(s).`;

			const argDescriptions = [
				"Required and must be a repository owner.",
				"Required and must be a project name",
				"Required and must be a valid version. ",
				"Required and must be a valid twitter consumer api key.",
				"Required and must be a valid twitter consumer api secret.",
				"Required and must be a valid twitter access token key.",
				"Required and must be a valid twitter access token secret.",
				"Required and must be a GitHub PAT (Personal Access Token).",
			];

			Utils.printAsGitHubError(errorMsg);
			Utils.printAsNumberedList(" Arg: ", argDescriptions, GitHubLogType.normal);
			Deno.exit(1);
		}

		this.printOrgRepoVarsUsed();

		let [orgName, repoName, version] = args;

		this.githubVarService.setOrgAndRepo(orgName, repoName);

		orgName = orgName.trim();
		repoName = repoName.trim();

		const orgClient = new OrgClient(this.token);
		const repoClient = new RepoClient(this.token);

		// If the org does not exist
		if (!(await orgClient.exists(orgName))) {
			Utils.printAsGitHubError(`The organization '${orgName}' does not exist.`);
			Deno.exit(1);
		}

		// If the repo does not exist
		if (!(await repoClient.exists(repoName))) {
			Utils.printAsGitHubError(`The repository '${repoName}' does not exist.`);
			Deno.exit(1);
		}

		if (Utils.isNotValidPreviewVersion(version) && Utils.isNotValidProdVersion(version)) {
			let errorMsg = `The version '${version}' is not a valid preview or production version.`;
			errorMsg += "\nRequired Syntax: v#.#.# or v#.#.#-preview.#";
			Utils.printAsGitHubError(errorMsg);
			Deno.exit(1);
		}

		const twitterBroadcastEnabled = (await this.githubVarService.getValue(
			SendReleaseTweetRunner.TWITTER_BROADCAST_ENABLED,
			false,
		)).toLowerCase();

		// Print out all of the required variables but only if the twitter broadcast is enabled
		if (!Utils.isNullOrEmptyOrUndefined(twitterBroadcastEnabled) && twitterBroadcastEnabled === "true") {
			const orgRepoVariables = this.getRequiredVars();

			// Check if all of the required org and/or repo variables exist
			const [orgRepoVarExist, missingVars] = await this.githubVarService.allVarsExist(orgRepoVariables);

			if (!orgRepoVarExist) {
				const missingVarErrors: string[] = [];

				for (let i = 0; i < missingVars.length; i++) {
					const missingVarName = missingVars[i];

					missingVarErrors.push(`The required org/repo variable '${missingVarName}' is missing.`);
				}

				Utils.printAsGitHubErrors(missingVarErrors);
				Deno.exit(1);
			}
		}
	}

	/**
	 * @inheritdoc
	 */
	protected mutateArgs(args: string[]): string[] {
		args = Utils.trimAll(args);

		let [orgName, repoName, version, consumerAPIKey, consumerAPISecret, accessTokenKey, accessTokenSecret, token] = args;

		version = version.toLowerCase();
		version = version.startsWith("v") ? version : `v${version}`;

		return [orgName, repoName, version, consumerAPIKey, consumerAPISecret, accessTokenKey, accessTokenSecret, token];
	}

	/**
	 * Prints the required org or repo variables for the runner.
	 */
	private printOrgRepoVarsUsed(): void {
		const title = "Required Org Or Repo Variables (if release tweet is enabled)";
		Utils.printInGroup(title, this.getRequiredVars());
	}

	/* Gets the list of required vars.
	 * @returns The list of required vars.
	*/
	private getRequiredVars(): string[] {
		return [
			SendReleaseTweetRunner.DISCORD_INVITE_CODE,
			SendReleaseTweetRunner.RELEASE_TWEET_TEMPLATE_REPO_NAME,
			SendReleaseTweetRunner.RELEASE_TWEET_TEMPLATE_BRANCH_NAME,
			SendReleaseTweetRunner.RELATIVE_RELEASE_TWEET_TEMPLATE_FILE_PATH,
		];
	}
}
