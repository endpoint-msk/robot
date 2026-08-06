import { Header, Screen } from 'endpoint-robot-webapp'

export const WithContent = () => (
  <Screen>
    <Header title="Настройки" />
    <div className="card">
      <div className="row">
        <span className="row-label">Тема</span>
        <div className="row-right">Системная</div>
      </div>
    </div>
  </Screen>
)

export const WithBottomBar = () => (
  <Screen hasBottomBar>
    <Header title="Новая заявка" />
    <div className="card">
      <div className="row">
        <span className="row-label">Среда, 5 августа · к 19:00</span>
      </div>
    </div>
  </Screen>
)
