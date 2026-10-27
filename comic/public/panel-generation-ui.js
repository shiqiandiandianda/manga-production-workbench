import {generationPromptSelection} from './prompt-source.js';
export function panelRoleLabel(project,panel){return panel.breakoutForeground?'透明前景':panel.sfxImage?'特效图片':'画格';}
export function panelGenerationFieldsMarkup(panel,escape,project){const choice=generationPromptSelection(panel,project);return '<label>分镜表提示词<textarea aria-label="当前生图提示词" data-section="panel-prompt" data-field="prompt" maxlength="20000" rows="8" '+(panel.locked?'disabled':'')+'>'+escape(choice.text)+'</textarea></label>';}
