schedule function hard_ender_dragon:crystal_summon 80s
execute as @e[type=ender_dragon,limit=1,sort=random] at @s unless entity @e[type=end_crystal,distance=..250] run summon end_crystal 0 120 0 {ShowBottom:0b,Glowing:1b}




