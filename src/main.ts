import { App, Editor, Modal, Notice, Plugin, Setting } from "obsidian";
import PyWorker from "pyworker.worker";


interface PluginState {
    enabled: boolean;
}


const DEFAULT_STATE: PluginState = {
    enabled: true,
};


export class YesNoModal extends Modal {
    constructor(app: App, text: string, onSubmit: (result: boolean) => void) {
        super(app);
        this.setContent(text);

        new Setting(this.contentEl)
            .addButton((btn) => btn
                .setButtonText("Yes")
                .setCta()
                .onClick(() => {
                    this.close();
                    onSubmit(true);
                }))

            .addButton((btn) => btn
                .setButtonText("No")
                .setCta()
                .onClick(() => {
                    this.close();
                    onSubmit(false);
                }));
    }
}


export default class Pycalc extends Plugin {
    private worker: Worker | null;
    private timer: any = null;
    private state: PluginState;

    executePythonCode(code: string, multiline: boolean) {
        if (multiline) {
            code = "1" + code;
        } else {
            code = "0" + code;
        }

        if (this.worker) {
            this.worker.postMessage(code);
        }
    }

    printResult(text: string) {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) {
            return;
        }

        const cursor = editor.getCursor();
        editor.replaceRange(text, cursor);
        cursor.ch += text.length

        editor.setCursor(cursor);
    }

    onEnter() {
        if (!this.isEnabled()) {
            return;
        }

        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) {
            return;
        }

        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line - 1);

        this.executePythonCode(line, false);
    }

    getCursorPos(editor: Editor) {
        const head = editor.getCursor("head");
        const anchor = editor.getCursor("anchor");

        if (head.line == anchor.line) {
            if (head.ch > anchor.ch) {
                return head;
            } else {
                return anchor;
            }
        } else if (head.line > anchor.line) {
            return head;
        }

        return anchor;
    }

    calcSelected() {
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) {
            return;
        }

        const pycode = editor.getSelection();
        const cursor = this.getCursorPos(editor);

        if (!pycode.endsWith("\n")) {
            editor.replaceRange("\n", cursor);
            cursor.ch = 0;
            cursor.line += 1;
        }

        editor.setSelection(cursor, cursor);
        this.executePythonCode(pycode, true);
    }

    checkLongRunning() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            const dialog = new YesNoModal(
                this.app,
                "The Python code has been running for a long time. Do you want to terminate it?",
                (result) => {
                    if (result) {
                        this.worker?.terminate();
                        this.worker = null;
                        this.createWorker();
                    }
                }
            );
            dialog.onClose = () => {
                this.checkLongRunning();
            };
            dialog.open();
        }, 30000);
    }

    createWorker() {
        this.worker = new PyWorker();
        this.checkLongRunning();

        this.worker.onmessage = (event) => {
            this.checkLongRunning();

            const message = event.data

            if ("stdout" in message) {
                const text = message["stdout"].join("");
                this.printResult(text)
            }

            if ("stderr" in message) {
                let error = message["stderr"].join("");

                const regex = / {2}(File "<\w+>", line \d+(, in <module>|).*)/s;
                const match = error.match(regex);
                if (match) {
                    error = match[1]
                }

                new Notice(`❌ ${error}`);
            }
        }

        this.worker.onmessageerror = (event) => {
            new Notice(`❌ ${event}`);
        };
    }

    releaseWorker() {
        if (this.worker) {
            clearTimeout(this.timer);
            this.worker.terminate();
            this.worker = null;
        }
    }

    isEnabled() {
        return this.state.enabled;
    }

    async setEnabled(enabled: boolean) {
        this.state.enabled = enabled;
        await this.saveData(this.state);
    }

    async pluginEnable() {
        this.releaseWorker();

        this.createWorker();

        await this.setEnabled(true);
    }

    async pluginDisable() {
        await this.setEnabled(false);
    }

    async onload() {
        this.state = Object.assign({}, DEFAULT_STATE, await this.loadData());

        this.createWorker();

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, view) => {
                if (this.state.enabled) {
                    menu.addItem((item) => {
                        item.setTitle("pycalc [✓]").
                            onClick(() => this.pluginDisable());
                    });
                } else {
                    menu.addItem((item) => {
                        item.setTitle("pycalc [×]").
                            onClick(() => this.pluginEnable());
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, view) => {
                menu.addItem((item) => {
                    item
                        .setTitle("pycalc selected")
                        .onClick(() => this.calcSelected());
                });
            })
        );

        this.addCommand({
            id: "selected",
            name: "selected",
            editorCallback: (editor: Editor) => {
                this.calcSelected();
            },
        });

        this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                this.onEnter();
            }
        });
    }
}
