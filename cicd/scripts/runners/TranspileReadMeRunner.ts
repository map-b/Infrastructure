import { Directory } from "../../core/Directory.ts";
import { GitHubLogType } from "../../core/Enums.ts";
import { File } from "../../core/File.ts";
import { Utils } from "../../core/Utils.ts";
import { ScriptRunner } from "./ScriptRunner.ts";

/**
 * Transpiles the HTML content in a README.md file to markdown.
 */
export class TranspileReadMeRunner extends ScriptRunner {
	private readonly readmeFileName = "README.md";
	private readonly divStartTagRegEx = /<div.*>/gm;
	private readonly divEndTagRegEx = /<\/div\s*>/gm;
	private readonly breakTagRegEx = /<br\s*\/>/gm;
	private readonly headerTagRegEx = /<h[1-6].*>.*<\/h[1-6]>/gm;
	private readonly headerStartTagRegEx = /<h[1-6].*?>/gm;
	private readonly headerEndTagRegEx = /<\/h[1-6]>/gm;
	private readonly styleAttrWithBoldRegEx = /style=\"(font:.*\sbold\s.*|font-weight:.*bold.*)\"/gm;
	private readonly imageTagRegEx = /<img .*src\s*=\s*('|").+('|").*>/gm;
	private readonly imgSrcAttrRegEx = /src\s*=\s*('|").+?('|")/gm;
	private readonly linkStartTagRegEx = /<a\s*href\s*=\s*('|").+?('|")>/gm;
	private readonly linkEndTagRegEx = /<\/\s*a\s*>/gm;
	private readonly markdownStartingWithWhiteSpaceRegEx = /^\s+!*\[.+\]\(.+\)/g;
	private readonly imgMarkdownLightModeRegex = /!\[.+\]\(.+-light-mode\.(svg|png|jpg|jpeg)#gh-light-mode-only\)/gm;
	private readonly imgMarkdownDarkModeRegex = /!\[.+\]\(.+-dark-mode\.(svg|png|jpg|jpeg)#gh-dark-mode-only\)/gm;

	/**
	 * Initializes a new instance of the {@link TranspileReadMeRunner} class.
	 * @param args The script arguments.
	 * @param scriptName The name of the script executing the runner.
	 */
	constructor(args: string[]) {
		super(args);
	}

	/**
	 * Runs the transpile readme script.
	 */
	public async run(): Promise<void> {
		await super.run();

		const [dirPath] = this.args;

		const readmeFilePath = `${dirPath}/${this.readmeFileName}`;

		if (File.DoesNotExist(readmeFilePath)) {
			let errorMsg = "Error with transpiling readme.";
			errorMsg += `\nThe given path '${readmeFilePath}' is not a valid file path.`;
			Utils.printAsGitHubError(errorMsg);
			Deno.exit(1);
		}

		let readmeFileContent = File.LoadFile(readmeFilePath);

		// Remove start and end div tags
		readmeFileContent = readmeFileContent.replace(this.divStartTagRegEx, "");
		readmeFileContent = readmeFileContent.replace(this.divEndTagRegEx, "");

		// Remove start and end link tags
		readmeFileContent = readmeFileContent.replace(this.linkStartTagRegEx, "");
		readmeFileContent = readmeFileContent.replace(this.linkEndTagRegEx, "");

		// Remove all break tags
		readmeFileContent = readmeFileContent.replaceAll(this.breakTagRegEx, "");

		readmeFileContent = this.transpileHeaderTags(readmeFileContent);

		readmeFileContent = this.transpileImageTags(readmeFileContent);

		readmeFileContent = this.removeDarkModeImages(readmeFileContent);

		readmeFileContent = this.bumpMarkdownLinksToLeft(readmeFileContent);

		// Overwrite the README.md file with the transpiled content
		File.SaveFile(readmeFilePath, readmeFileContent);

		Utils.printAsGitHubNotice("Successfully transpiled the README.md file.");
	}

	/**
	 * @inheritdoc
	 */
	// deno-lint-ignore require-await
	protected async validateArgs(args: string[]): Promise<void> {
		if (args.length != 2) {
			const mainMsg = `The cicd script must have 2 arguments but has ${args.length} argument(s).`;

			const argDescriptions = [
				"Required and must be a valid directory path to the 'README.md' file.",
				"Required and must be a valid GitHub PAT (Personal Access Token).",
			];

			Utils.printAsGitHubError(mainMsg);
			Utils.printAsNumberedList(" Arg: ", argDescriptions, GitHubLogType.normal);
			Deno.exit(1);
		}

		if (Directory.DoesNotExist(args[0])) {
			Utils.printAsGitHubError(`The given path '${args[0]}' is not a valid directory path.`);
			Deno.exit(1);
		}
	}

	/**
	 * @inheritdoc
	 */
	protected mutateArgs(args: string[]): string[] {
		let [dirPath, token] = args;
		dirPath = Utils.normalizePath(args[0]);
		dirPath = Utils.trimAllEndingValue(dirPath, "/");

		return [dirPath, token];
	}

	/**
	 * Transpiles all HTML header tags to markdown headers.
	 * @param content The content to transpile.
	 * @returns The transpiled content.
	 */
	private transpileHeaderTags(content: string): string {
		const headers = content.match(this.headerTagRegEx)?.filter((h) => h) ?? [];

		for (const headerHtml of headers) {
			let headerContent = headerHtml.replace(this.headerStartTagRegEx, "");
			headerContent = headerContent.replace(this.headerEndTagRegEx, "");

			// If the header style is set to bold
			if (this.styleAttrWithBoldRegEx.test(content)) {
				headerContent = `**${headerContent}**`;
			}

			const headerLevel = this.getHeaderLevel(headerHtml);
			const hashes = this.generateDuplicates("#", headerLevel);

			const headerMarkdown = `${hashes} ${headerContent}`;

			content = content.replaceAll(headerHtml, headerMarkdown);
		}

		return content;
	}

	/**
	 * Transpiles all HTML image tags to markdown images.
	 * @param content The content to transpile.
	 * @returns The transpiled content.
	 */
	private transpileImageTags(content: string): string {
		const imgHtmlTags = content.match(this.imageTagRegEx)?.filter((h) => h) ?? [];

		for (const imgHtml of imgHtmlTags) {
			const imgSrcAttr = imgHtml.match(this.imgSrcAttrRegEx)?.filter((h) => h)[0] ?? "";

			let srcUri = imgSrcAttr.replace("src=", "");
			srcUri = srcUri.replaceAll('"', "");
			srcUri = srcUri.replaceAll("'", "");

			const imgMarkdown = `![image](${srcUri})`;

			content = content.replaceAll(imgHtml, imgMarkdown);
		}

		return content;
	}

	/**
	 * Removes all dark mode images from the given content.
	 * @param content The content that might contain the markdown images.
	 * @returns The content with the dark mode images removed.
	 */
	public removeDarkModeImages(content: string): string {
		const darkModeImages = content.match(this.imgMarkdownDarkModeRegex)?.filter((m) => m) ?? [];
		const lightModeImages = content.match(this.imgMarkdownLightModeRegex)?.filter((m) => m) ?? [];

		for (const darkModeImage of darkModeImages) {
			const darkModeItem = this.getFileNameWithoutMode(darkModeImage);

			const lightModeItem = this.getFileNameWithoutMode(
				lightModeImages.find((l) => {
					return this.getFileNameWithoutMode(l) === darkModeItem;
				}) ?? "",
			);

			if (lightModeItem === "") {
				let errorMsg = `The markdown dark mode image '${darkModeImage}' does not have a matching light mode image.`;
				errorMsg += "\nIf a dark mode image is being used, then a light mode image must also be used.";
				errorMsg += "\nThis is to ensure that a light mode image is left behind for the README.md file for nuget.org.";
				errorMsg += "\nThis is because nuget.org does not support the GitHub dark mode syntax.";
				Utils.printAsGitHubError(errorMsg);
				Deno.exit(1);
			}

			if (lightModeItem === darkModeItem) {
				content = content.replaceAll(darkModeImage, "");
			}
		}

		return content;
	}

	/**
	 * Gets the file name without the mode string that is embedded in the given {@link markdown}.
	 * @param markdown The markdown content to process.
	 * @returns The file name without the mode string.
	 */
	private getFileNameWithoutMode(markdown: string): string {
		const modeKeyWordsWithExtRegex = /-(light|dark)-mode\.(svg|png|jpg|jpeg)/gm;

		const fileName = this.getImageFileNameFromImgMarkdown(markdown);

		const darkTextToRemove = fileName.match(modeKeyWordsWithExtRegex)?.filter((m) => m)[0] ?? "";

		return fileName.replace(darkTextToRemove, "");
	}

	/**
	 * Gets the image file name from the given {@link markdown}.
	 * @param markdown The markdown content to process.
	 * @returns The file file name from the image markdown.
	 */
	private getImageFileNameFromImgMarkdown(markdown: string): string {
		const lightModeRegex = /#gh-light-mode-only/gm;
		const darkModeRegex = /#gh-dark-mode-only/gm;

		if (!lightModeRegex.test(markdown) && !darkModeRegex.test(markdown)) {
			return markdown;
		}

		const uri = markdown.replace(/!\[.+\]\(/gm, "")
			.replace(")", "")
			.replace(lightModeRegex, "")
			.replace(darkModeRegex, "")
			.replaceAll("\\", "/");

		const uriSections = uri.split("/");

		return uriSections[uriSections.length - 1];
	}

	/**
	 * Finds all markdown links that are preceded by white space and bumps them to the left
	 * by removing that beginning white space.
	 * @param content The content to mutate.
	 * @returns The mutated content.
	 */
	private bumpMarkdownLinksToLeft(content: string): string {
		content = Utils.normalizeLineEndings(content);

		const lines = Utils.splitBy(content, "\n");

		for (let i = 0; i < lines.length; i++) {
			if (this.markdownStartingWithWhiteSpaceRegEx.test(lines[i])) {
				lines[i] = Utils.trimAllStartingWhiteSpace(lines[i]);
			}
		}

		return lines.join("\n");
	}

	/**
	 * Gets the header level of the given {@link htmlHeader}.
	 * @param htmlHeader The HTML header to analyze.
	 * @returns The header level of 1 to 6.
	 */
	private getHeaderLevel(htmlHeader: string): number {
		const headerStartTags = htmlHeader.match(this.headerStartTagRegEx)?.filter((h) => h) ?? [];

		const headerStartTag = headerStartTags[0].toLowerCase();

		// Split the start tag right after the '<h1' section
		const sections = Utils.splitBy(headerStartTag, " ");
		const startSection = sections[0];

		const headerLevelStr = startSection.replace("<h", "");

		return parseInt(headerLevelStr);
	}

	/**
	 * Returns the given {@link value} duplicated {@link count} times.
	 * @param value The value to duplicate.
	 * @param count The number of times to duplicate the {@link value}.
	 * @returns The given {@link value} duplicated {@link count} times.
	 */
	private generateDuplicates(value: string, count: number): string {
		let duplicates = "";

		for (let i = 0; i < count; i++) {
			duplicates += value;
		}

		return duplicates;
	}
}
