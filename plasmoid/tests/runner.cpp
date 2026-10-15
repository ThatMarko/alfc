#include <QDirIterator>
#include <QFile>
#include <QJSValue>
#include <QQmlEngine>
#include <QTemporaryDir>
#include <QtQuickTest/quicktest.h>

class Setup : public QObject {
    Q_OBJECT
    QTemporaryDir staged;

public:
    Setup() {
        // Only the shell-owned heading and attached applet APIs are replaced.
        // All controls, layouts, forms and editor rendering use distro plugins.
        const QString source = QStringLiteral(ALFC_TEST_SOURCE);
        const QString ui = source + "/package/contents/ui";
        QDirIterator entries(ui, QDir::Files);
        while (entries.hasNext()) {
            const QString path = entries.next();
            if (!QFile::copy(path, staged.path() + "/" + entries.fileName()))
                qFatal("Cannot stage widget component: %s", qPrintable(path));
        }
        QFile::remove(staged.path() + "/WidgetHeading.qml");
        if (!QFile::copy(source + "/tests/fixtures/WidgetHeading.qml", staged.path() + "/WidgetHeading.qml"))
            qFatal("Cannot stage the documented shell heading fixture");
    }

public slots:
    void qmlEngineAvailable(QQmlEngine *engine) {
        const QString source = QStringLiteral(ALFC_TEST_SOURCE);
        engine->addImportPath(source + "/tests/shell");
        engine->globalObject().setProperty("alfcTestTier", "components");
        engine->globalObject().setProperty("alfcComponentUi", staged.path());
        engine->globalObject().setProperty("alfcSettingsFile", staged.path() + "/settings.ini");
        const auto translate = engine->evaluate("(function(message) { for (let i = 1; i < arguments.length; ++i) message = message.replace('%' + i, String(arguments[i])); return message; })");
        engine->globalObject().setProperty("i18n", translate);
        const auto contextual = engine->evaluate("(function(context, message) { for (let i = 2; i < arguments.length; ++i) message = message.replace('%' + (i - 1), String(arguments[i])); return message; })");
        engine->globalObject().setProperty("i18nc", contextual);
        engine->globalObject().setProperty("i18nd", contextual);
    }
};

QUICK_TEST_MAIN_WITH_SETUP(alfc_widget_components, Setup)
#include "runner.moc"
