# Armic

ARMIC is a Platform that fuses advanced robotics, Blockchain and AI Agents to transform patient rehabilitation.

# Materials:

Hardware:
- [ESP32. 2x](https://www.adafruit.com/product/3405)
- [ADXL335. 1x](https://www.adafruit.com/product/163)
- [Robotic Arm x1.](https://www.amazon.com/OWI-Robotic-Soldering-Required-Extensive/dp/B0017OFRCY)
- [8 Channel DC 5V Relay Module with Optocoupler x1.](https://www.amazon.com/Elegoo-Module-Optocoupler-Arduino-Raspberry/dp/B07F623PHG)

Software:
- [Base](https://base.org/)
- [CDP Agentkit](https://python.langchain.com/docs/integrations/tools/cdp_agentkit/)
- [Remix IDE](https://remix.ethereum.org/)
- [Eclipse Mosquitto](https://github.com/eclipse-mosquitto/mosquitto)
- [Arduino IDE](https://www.arduino.cc/en/software)
- [Ollama](https://ollama.com/)
- [LangGraph](https://www.langchain.com/langgraph)
- [Edge Impulse](https://edgeimpulse.com/)
- [Alchemy](https://www.alchemy.com/)
- [NextJS](https://nextjs.org/)

## System Diagram:

<img src="./Images/system.png">

- Base: Blockchain principal, gracias a su velocidad de transaccion la comunicacion entre losdevices IoT, Plataforma Web y AI Agents no se ve comprometida.
- CDP Platform: Todas las interacciones entre los agentes y la blockchain se realiza mediante este toolkit compatible con LangGraph.
- Edge Impulse: Se utilizo este AI Framework para desarrollar la AI de deteccion de ejercicios IoT.
- Eclipse Mosquitto: Realiza la comunicacion entre todos los devices IoT, Plataforma Web y AI Agents.

# IoT Devices:

### AI Exercise Tracker:

AI Exercise Tracker Diagram:

<img src="./Images/Exercise Tracking.png" width="70%">

### Exercise Tracker Model:

Edge Model Accuracy:

<img src="./Images/accuracy.png">

Edge Model Confusion Matrix:

<img src="./Images/confmatrix.png">

### Arm Digital Driver:

Arm Digital Driver Diagram:

<img src="./Images/armdriver.png" width="70%">

# Nethermind:

Dentro de nuestro sistema de AI Agents nos basamos completamente en los diagramas del articulo de la empresa 
Anthropic [1](#references).

<img src="./Images/diagram1.png">

## LLM:

Todo nuestro servidor de LLM esta basado en dos servicios principales, los cuales son Ollama y LangGraph.

<img src="./Images/langgraph.drawio.png">

- Ollama:

    Este sevicio nos permite de forma sencilla correr cualquier modelo LLM sin la necesidad de relizar configuraciones adicionales. Ademas de poder correr los modelos mas populares de forma local.

- LangGraph:

    Este framework nos permite crear sistemas de agentes complejos, asi como manejar las llamadas a tools y sobretodo permitiendonos que los Agentes pudan controlar interacciones con la blockchain gracias a su integracion de AgentKit CDP.

## Workflow: Prompt chaining

Dentro de nuestra infraestructura de agentes realizamos varias cadenas de agentes, esto con el fin de activar herramientas y generar respuestas para los usuarios con lenguaje natual, siendo esta una etapa de pre procesado.

<img src="./Images/diagram2.png">

La seccion de codigo que mejor representa esto, es la primera llamada al AI Agent, donde primero ejecutamos una consulta al agente para obtener una estructura y posteriormente pasamos esta respuesta al segundo agente el cual nos provee el mensaje final al usuario.

    exercise = model_with_structure.invoke(setPrompt(my_payload["message"]))
    events = model.invoke(setPrompt2(exercise))
    client.publish("webpage/input", events.content)

El codigo completo de este fragmento esta en el siguiente enlace:

[LLM SERVER](./LLM%20Server/Armic_Final.ipynb)

# References:

1. https://www.anthropic.com/research/building-effective-agents