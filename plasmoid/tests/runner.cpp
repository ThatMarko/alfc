#include <QDirIterator>
#include <QFile>
#include <QJSValue>
#include <QHostAddress>
#include <QQmlEngine>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QtQuickTest/quicktest.h>

class Setup : public QObject {
    Q_OBJECT
    Q_PROPERTY(int connections READ connections NOTIFY connectionsChanged)
    QTemporaryDir staged;
    QTcpServer *silentServer = nullptr;
    int silentConnections = 0;

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

    int connections() const { return silentConnections; }

signals:
    void connectionsChanged();

public slots:
    void qmlEngineAvailable(QQmlEngine *engine) {
        if (!silentServer) {
            silentServer = new QTcpServer(this);
            connect(silentServer, &QTcpServer::newConnection, this, [this]() {
                while (silentServer->hasPendingConnections()) {
                    auto *socket = silentServer->nextPendingConnection();
                    socket->setParent(silentServer);
                    connect(socket, &QTcpSocket::readyRead, socket, [socket]() { socket->readAll(); });
                    connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                    socket->readAll();
                    ++silentConnections;
                    emit connectionsChanged();
                }
            });
            if (!silentServer->listen(QHostAddress::LocalHost, 0))
                qFatal("Cannot listen for silent WebSocket handshakes: %s", qPrintable(silentServer->errorString()));
        }
        // Accept TCP requests without sending an HTTP/WebSocket handshake.
        // QObject ownership closes outstanding sockets with the test setup.
        engine->globalObject().setProperty("alfcSilentHandshakeEndpoint", QStringLiteral("ws://127.0.0.1:%1/ws").arg(silentServer->serverPort()));
        QQmlEngine::setObjectOwnership(this, QQmlEngine::CppOwnership);
        engine->globalObject().setProperty("alfcSilentHandshakeProbe", engine->newQObject(this));
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
