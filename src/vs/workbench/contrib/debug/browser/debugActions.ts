/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import * as lifecycle from 'vs/base/common/lifecycle';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IDebugService, State, IEnablement, IBreakpoint, REPL_ID } from 'vs/workbench/contrib/debug/common/debug';
import { Variable, Expression, Breakpoint } from 'vs/workbench/contrib/debug/common/debugModel';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { TogglePanelAction } from 'vs/workbench/browser/panel';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { startDebugging } from 'vs/workbench/contrib/debug/common/debugUtils';

export abstract class AbstractDebugAction extends Action {

	protected toDispose: lifecycle.IDisposable[];

	constructor(
		id: string, label: string, cssClass: string,
		@IDebugService protected debugService: IDebugService,
		@IKeybindingService protected keybindingService: IKeybindingService,
		public weight?: number
	) {
		super(id, label, cssClass, false);
		this.toDispose = [];
		this.toDispose.push(this.debugService.onDidChangeState(state => this.updateEnablement(state)));

		this.updateLabel(label);
		this.updateEnablement();
	}

	public run(e?: any): Promise<any> {
		throw new Error('implement me');
	}

	public get tooltip(): string {
		const keybinding = this.keybindingService.lookupKeybinding(this.id);
		const keybindingLabel = keybinding && keybinding.getLabel();

		return keybindingLabel ? `${this.label} (${keybindingLabel})` : this.label;
	}

	protected updateLabel(newLabel: string): void {
		this.label = newLabel;
	}

	protected updateEnablement(state = this.debugService.state): void {
		this.enabled = this.isEnabled(state);
	}

	protected isEnabled(state: State): boolean {
		return true;
	}

	public dispose(): void {
		super.dispose();
		this.toDispose = lifecycle.dispose(this.toDispose);
	}
}

export class ConfigureAction extends AbstractDebugAction {
	static readonly ID = 'workbench.action.debug.configure';
	static LABEL = nls.localize('openLaunchJson', "Open {0}", 'launch.json');

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService
	) {
		super(id, label, 'debug-action configure', debugService, keybindingService);
		this.toDispose.push(debugService.getConfigurationManager().onDidSelectConfiguration(() => this.updateClass()));
		this.updateClass();
	}

	public get tooltip(): string {
		if (this.debugService.getConfigurationManager().selectedConfiguration.name) {
			return ConfigureAction.LABEL;
		}

		return nls.localize('launchJsonNeedsConfigurtion', "Configure or Fix 'launch.json'");
	}

	private updateClass(): void {
		const configurationManager = this.debugService.getConfigurationManager();
		const configurationCount = configurationManager.getLaunches().map(l => l.getConfigurationNames().length).reduce((sum, current) => sum + current);
		this.class = configurationCount > 0 ? 'debug-action configure' : 'debug-action configure notification';
	}

	public run(event?: any): Promise<any> {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.notificationService.info(nls.localize('noFolderDebugConfig', "Please first open a folder in order to do advanced debug configuration."));
			return Promise.resolve();
		}

		const sideBySide = !!(event && (event.ctrlKey || event.metaKey));
		const configurationManager = this.debugService.getConfigurationManager();
		if (!configurationManager.selectedConfiguration.launch) {
			configurationManager.selectConfiguration(configurationManager.getLaunches()[0]);
		}

		return configurationManager.selectedConfiguration.launch!.openConfigFile(sideBySide, false);
	}
}

export class StartAction extends AbstractDebugAction {
	static ID = 'workbench.action.debug.start';
	static LABEL = nls.localize('startDebug', "Start Debugging");

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IHistoryService private readonly historyService: IHistoryService
	) {
		super(id, label, 'debug-action start', debugService, keybindingService);

		this.toDispose.push(this.debugService.getConfigurationManager().onDidSelectConfiguration(() => this.updateEnablement()));
		this.toDispose.push(this.debugService.onDidNewSession(() => this.updateEnablement()));
		this.toDispose.push(this.debugService.onDidEndSession(() => this.updateEnablement()));
		this.toDispose.push(this.contextService.onDidChangeWorkbenchState(() => this.updateEnablement()));
	}

	public run(): Promise<boolean> {
		return startDebugging(this.debugService, this.historyService, this.isNoDebug());
	}

	protected isNoDebug(): boolean {
		return false;
	}

	public static isEnabled(debugService: IDebugService) {
		const sessions = debugService.getModel().getSessions();

		if (debugService.state === State.Initializing) {
			return false;
		}
		if ((sessions.length > 0) && debugService.getConfigurationManager().getLaunches().every(l => l.getConfigurationNames().length === 0)) {
			// There is already a debug session running and we do not have any launch configuration selected
			return false;
		}

		return true;
	}

	// Disabled if the launch drop down shows the launch config that is already running.
	protected isEnabled(): boolean {
		return StartAction.isEnabled(this.debugService);
	}
}

export class RunAction extends StartAction {
	static readonly ID = 'workbench.action.debug.run';
	static LABEL = nls.localize('startWithoutDebugging', "Start Without Debugging");

	protected isNoDebug(): boolean {
		return true;
	}
}

export class SelectAndStartAction extends AbstractDebugAction {
	static readonly ID = 'workbench.action.debug.selectandstart';
	static LABEL = nls.localize('selectAndStartDebugging', "Select and Start Debugging");

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IQuickOpenService private readonly quickOpenService: IQuickOpenService
	) {
		super(id, label, '', debugService, keybindingService);
	}

	public run(): Promise<any> {
		return this.quickOpenService.show('debug ');
	}
}

export class RemoveBreakpointAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.removeBreakpoint';
	static LABEL = nls.localize('removeBreakpoint', "Remove Breakpoint");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action remove', debugService, keybindingService);
	}

	public run(breakpoint: IBreakpoint): Promise<any> {
		return breakpoint instanceof Breakpoint ? this.debugService.removeBreakpoints(breakpoint.getId())
			: this.debugService.removeFunctionBreakpoints(breakpoint.getId());
	}
}

export class RemoveAllBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.removeAllBreakpoints';
	static LABEL = nls.localize('removeAllBreakpoints', "Remove All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action remove-all', debugService, keybindingService);
		this.toDispose.push(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	public run(): Promise<any> {
		return Promise.all([this.debugService.removeBreakpoints(), this.debugService.removeFunctionBreakpoints()]);
	}

	protected isEnabled(state: State): boolean {
		const model = this.debugService.getModel();
		return super.isEnabled(state) && (model.getBreakpoints().length > 0 || model.getFunctionBreakpoints().length > 0);
	}
}

export class EnableAllBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.enableAllBreakpoints';
	static LABEL = nls.localize('enableAllBreakpoints', "Enable All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action enable-all-breakpoints', debugService, keybindingService);
		this.toDispose.push(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	public run(): Promise<any> {
		return this.debugService.enableOrDisableBreakpoints(true);
	}

	protected isEnabled(state: State): boolean {
		const model = this.debugService.getModel();
		return super.isEnabled(state) && (<ReadonlyArray<IEnablement>>model.getBreakpoints()).concat(model.getFunctionBreakpoints()).concat(model.getExceptionBreakpoints()).some(bp => !bp.enabled);
	}
}

export class DisableAllBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.disableAllBreakpoints';
	static LABEL = nls.localize('disableAllBreakpoints', "Disable All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action disable-all-breakpoints', debugService, keybindingService);
		this.toDispose.push(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	public run(): Promise<any> {
		return this.debugService.enableOrDisableBreakpoints(false);
	}

	protected isEnabled(state: State): boolean {
		const model = this.debugService.getModel();
		return super.isEnabled(state) && (<ReadonlyArray<IEnablement>>model.getBreakpoints()).concat(model.getFunctionBreakpoints()).concat(model.getExceptionBreakpoints()).some(bp => bp.enabled);
	}
}

export class ToggleBreakpointsActivatedAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.toggleBreakpointsActivatedAction';
	static ACTIVATE_LABEL = nls.localize('activateBreakpoints', "Activate Breakpoints");
	static DEACTIVATE_LABEL = nls.localize('deactivateBreakpoints', "Deactivate Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action breakpoints-activate', debugService, keybindingService);
		this.updateLabel(this.debugService.getModel().areBreakpointsActivated() ? ToggleBreakpointsActivatedAction.DEACTIVATE_LABEL : ToggleBreakpointsActivatedAction.ACTIVATE_LABEL);

		this.toDispose.push(this.debugService.getModel().onDidChangeBreakpoints(() => {
			this.updateLabel(this.debugService.getModel().areBreakpointsActivated() ? ToggleBreakpointsActivatedAction.DEACTIVATE_LABEL : ToggleBreakpointsActivatedAction.ACTIVATE_LABEL);
			this.updateEnablement();
		}));
	}

	public run(): Promise<any> {
		return this.debugService.setBreakpointsActivated(!this.debugService.getModel().areBreakpointsActivated());
	}

	protected isEnabled(state: State): boolean {
		return (this.debugService.getModel().getFunctionBreakpoints().length + this.debugService.getModel().getBreakpoints().length) > 0;
	}
}

export class ReapplyBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.reapplyBreakpointsAction';
	static LABEL = nls.localize('reapplyAllBreakpoints', "Reapply All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, '', debugService, keybindingService);
		this.toDispose.push(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	public run(): Promise<any> {
		return this.debugService.setBreakpointsActivated(true);
	}

	protected isEnabled(state: State): boolean {
		const model = this.debugService.getModel();
		return super.isEnabled(state) && (state === State.Running || state === State.Stopped) &&
			(model.getFunctionBreakpoints().length + model.getBreakpoints().length + model.getExceptionBreakpoints().length > 0);
	}
}

export class AddFunctionBreakpointAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.addFunctionBreakpointAction';
	static LABEL = nls.localize('addFunctionBreakpoint', "Add Function Breakpoint");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action add-function-breakpoint', debugService, keybindingService);
		this.toDispose.push(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	public run(): Promise<any> {
		this.debugService.addFunctionBreakpoint();
		return Promise.resolve();
	}

	protected isEnabled(state: State): boolean {
		return !this.debugService.getViewModel().getSelectedFunctionBreakpoint()
			&& this.debugService.getModel().getFunctionBreakpoints().every(fbp => !!fbp.name);
	}
}

export class AddWatchExpressionAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.addWatchExpression';
	static LABEL = nls.localize('addWatchExpression', "Add Expression");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action add-watch-expression', debugService, keybindingService);
		this.toDispose.push(this.debugService.getModel().onDidChangeWatchExpressions(() => this.updateEnablement()));
	}

	public run(): Promise<any> {
		this.debugService.addWatchExpression();
		return Promise.resolve(undefined);
	}

	protected isEnabled(state: State): boolean {
		return super.isEnabled(state) && this.debugService.getModel().getWatchExpressions().every(we => !!we.name);
	}
}

export class EditWatchExpressionAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.editWatchExpression';
	static LABEL = nls.localize('editWatchExpression', "Edit Expression");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, '', debugService, keybindingService);
	}

	public run(expression: Expression): Promise<any> {
		this.debugService.getViewModel().setSelectedExpression(expression);
		return Promise.resolve();
	}
}

export class RemoveWatchExpressionAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.removeWatchExpression';
	static LABEL = nls.localize('removeWatchExpression', "Remove Expression");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, '', debugService, keybindingService);
	}

	public run(expression: Expression): Promise<any> {
		this.debugService.removeWatchExpressions(expression.getId());
		return Promise.resolve();
	}
}

export class RemoveAllWatchExpressionsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.removeAllWatchExpressions';
	static LABEL = nls.localize('removeAllWatchExpressions', "Remove All Expressions");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action remove-all', debugService, keybindingService);
		this.toDispose.push(this.debugService.getModel().onDidChangeWatchExpressions(() => this.updateEnablement()));
	}

	public run(): Promise<any> {
		this.debugService.removeWatchExpressions();
		return Promise.resolve();
	}

	protected isEnabled(state: State): boolean {
		return super.isEnabled(state) && this.debugService.getModel().getWatchExpressions().length > 0;
	}
}

export class ToggleReplAction extends TogglePanelAction {
	static readonly ID = 'workbench.debug.action.toggleRepl';
	static LABEL = nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugConsoleAction' }, 'Debug Console');
	private toDispose: lifecycle.IDisposable[];

	constructor(id: string, label: string,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IPanelService panelService: IPanelService
	) {
		super(id, label, REPL_ID, panelService, layoutService, 'debug-action toggle-repl');
		this.toDispose = [];
		this.registerListeners();
	}

	private registerListeners(): void {
		this.toDispose.push(this.panelService.onDidPanelOpen(({ panel }) => {
			if (panel.getId() === REPL_ID) {
				this.class = 'debug-action toggle-repl';
				this.tooltip = ToggleReplAction.LABEL;
			}
		}));
	}

	public dispose(): void {
		super.dispose();
		this.toDispose = lifecycle.dispose(this.toDispose);
	}
}

export class FocusSessionAction extends AbstractDebugAction {
	static readonly ID = 'workbench.action.debug.focusProcess';
	static LABEL = nls.localize('focusSession', "Focus Session");

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(id, label, '', debugService, keybindingService, 100);
	}

	public run(sessionName: string): Promise<any> {
		const session = this.debugService.getModel().getSessions().filter(p => p.getLabel() === sessionName).pop();
		this.debugService.focusStackFrame(undefined, undefined, session, true);
		const stackFrame = this.debugService.getViewModel().focusedStackFrame;
		if (stackFrame) {
			return stackFrame.openInEditor(this.editorService, true);
		}

		return Promise.resolve(undefined);
	}
}

export class CopyValueAction extends Action {
	static readonly ID = 'workbench.debug.viewlet.action.copyValue';
	static LABEL = nls.localize('copyValue', "Copy Value");

	constructor(
		id: string, label: string, private value: any, private context: string,
		@IDebugService private readonly debugService: IDebugService,
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		super(id, label, 'debug-action copy-value');
		this._enabled = typeof this.value === 'string' || (this.value instanceof Variable && !!this.value.evaluateName);
	}

	public run(): Promise<any> {
		const stackFrame = this.debugService.getViewModel().focusedStackFrame;
		const session = this.debugService.getViewModel().focusedSession;

		if (this.value instanceof Variable && stackFrame && session && this.value.evaluateName) {
			return session.evaluate(this.value.evaluateName, stackFrame.frameId, this.context).then(result => {
				this.clipboardService.writeText(result.body.result);
			}, err => this.clipboardService.writeText(this.value.value));
		}

		this.clipboardService.writeText(this.value);
		return Promise.resolve(undefined);
	}
}
