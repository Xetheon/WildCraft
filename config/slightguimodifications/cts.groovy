mainMenu {
    enabled = true

    splashText {
        enabled = true
        splashesEnabled = false
    }

    background {
        clearBackgrounds()
        backgroundStayLength = 50000
        backgroundFadeLength = 2000
        renderGradientShade = false
        image { texture = file("config/slightguimodifications/background.png") }
    }

    removeMinecraftLogo()
    removeEditionBadge()
    clearAllButtons()

    label {
        position {
            x = 2
            y {
                it - 20
            }
        }
        shadow = true
        text = literal("WildCraft Dev")
    }

    button {
        position {
            x { it / 2 -101 }
            y = 179
        }
        width = 204
        height = 20

        text = modMenuText()
        onClicked = modMenu()
    }
/*    button {
        position {
            x { it / 2 - 49 }
            y = 227
        }
        width = 100
        height = 20

        text = literal("Languages")
        onClicked = language()
    } */
    button {
        position {
            x { it / 2 - 101 }
            y = 131
        }
        width = 204
        height = 20

        text = translatable("menu.singleplayer")
        onClicked = singleplayer()
    }
    button {
        position {
            x { it / 2 - 101 }
            y = 155
        }
        width = 204
        height = 20

        text = translatable("menu.multiplayer")
        onClicked = multiplayer()
    }
    button {
        position {
            x { it / 2 + 3 }
            y = 203
        }
        width = 100
        height = 20

        text = translatable("menu.quit")
        onClicked = exit()
    }
    button {
        position {
            x { it / 2 - 101 }
            y = 203
        }
        width = 100
        height = 20

        text = translatable("menu.options")
        onClicked = options()
    }
 /*   button {
        position {
            x { it / 1 - 101 }
            y = 1000
        }
        width = 100
        height = 20

        text = literal("Placeholder")
        onClicked = url("https://cdn.discordapp.com/attachments/652242227434881035/771550563514712064/EUrsI6SU0AAEQZ4.jpg")
    } */
}
