import autoreply from "./autoreply";
import common from "./common";
import dashboard from "./dashboard";
import editor from "./editor";
import format from "./format";
import jobs from "./jobs";
import landing from "./landing";
import media from "./media";
import legal from "./legal";
import posts from "./posts";
import shell from "./shell";
import studio from "./studio";
import templates from "./templates";

/** 네임스페이스별 문구. 키는 t("studio.title") 처럼 "네임스페이스.키" 로 씁니다. */
export const messages = { common, format, landing, shell, dashboard, studio, posts, jobs, autoreply, legal, templates, editor, media };
