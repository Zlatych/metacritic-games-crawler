CREATE TABLE `daily_progress` (
	`day` text PRIMARY KEY NOT NULL,
	`new_releases_done` integer DEFAULT false NOT NULL,
	`browse_page` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_platforms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_lead` integer DEFAULT false NOT NULL,
	`release_date` text,
	`metascore` integer,
	`critic_count` integer DEFAULT 0 NOT NULL,
	`userscore` real,
	`user_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_platform_uq` ON `game_platforms` (`game_id`,`slug`);--> statement-breakpoint
CREATE INDEX `game_platform_name_idx` ON `game_platforms` (`name`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover_url` text,
	`developer` text,
	`publisher` text,
	`genres` text DEFAULT '[]' NOT NULL,
	`release_date` text,
	`rating` text,
	`video_url` text,
	`video_title` text,
	`metascore` integer,
	`userscore` real,
	`critic_review_count` integer DEFAULT 0 NOT NULL,
	`user_review_count` integer DEFAULT 0 NOT NULL,
	`critic_summary` text,
	`user_summary` text,
	`critic_reviews_hash` text,
	`user_reviews_hash` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_slug_unique` ON `games` (`slug`);--> statement-breakpoint
CREATE INDEX `games_title_idx` ON `games` (`title`);--> statement-breakpoint
CREATE INDEX `games_metascore_idx` ON `games` (`metascore`);--> statement-breakpoint
CREATE TABLE `letsplays` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`video_id` text,
	`title` text,
	`channel` text,
	`views` integer,
	`duration` integer,
	`transcript_source` text,
	`transcript` text,
	`conclusion` text,
	`error` text,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `processed_games` (
	`day` text NOT NULL,
	`slug` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`run_id` integer,
	`processed_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`day`, `slug`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`finished_at` text,
	`selected` integer DEFAULT 0 NOT NULL,
	`scraped` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `similar_games` (
	`game_id` integer NOT NULL,
	`similar_id` integer NOT NULL,
	`score` real NOT NULL,
	PRIMARY KEY(`game_id`, `similar_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`similar_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
